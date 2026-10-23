import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { z } from 'zod'
import { notifyAdmins } from '@/lib/push'
import { learningHints } from '@/lib/receipt-learning'
import { createAdminClient } from '@/lib/supabase/admin'

// 비용을 줄이려고 Haiku 사용 (사장님 결정 2026-10-23). 정확도가 아쉬우면 claude-sonnet-5-5 / claude-opus-5-5 로.
const MODEL = 'claude-haiku-5-5'
export const RECEIPT_BUCKET = 'receipt-photos'

// AI가 돌려줄 형식. 이 값은 "제안"일 뿐이고, 관리자가 확정해야 실제 기록이 됨.
export const ReceiptProposalSchema = z.object({
  vendor: z.string().nullable().describe('거래처(공급자) 상호. 안 보이면 null'),
  receipt_date: z.string().nullable().describe('전표 날짜 YYYY-MM-DD. 안 보이면 null'),
  items: z
    .array(
      z.object({
        name: z.string().describe('품목명 (사진에 적힌 그대로)'),
        quantity: z.number().nullable().describe('수량. 안 보이면 null'),
        unit: z.string().nullable().describe('단위 (kg, 박스, 개 등). 없으면 null'),
        unit_price: z.number().nullable().describe('전표에 적힌 단가 (원). 안 보이면 null'),
        line_total: z
          .number()
          .nullable()
          .describe('그 줄의 공급가(공급가액, 원). 세액이 따로 없는 전표면 그 줄의 금액. 안 보이면 null'),
        tax: z.number().nullable().describe('그 줄의 세액(부가세, 원). 세액 칸이 없거나 비어 있으면 null'),
      }),
    )
    .describe('품목 줄. 공급가액·부가세·합계 줄은 넣지 않음'),
  total_amount: z.number().nullable().describe('전표의 최종 합계 금액 (원). 안 보이면 null'),
  notes: z.string().nullable().describe('읽기 어려웠던 부분이나 확인이 필요한 점. 없으면 null'),
})
export type ReceiptProposal = z.infer<typeof ReceiptProposalSchema>

function prompt(photoCount: number, hints: string) {
  return `이 사진 ${photoCount}장은 한식당이 거래처(식자재 업체 등)에서 받은 전표(거래명세표 또는 영수증)입니다.
여러 장이면 한 전표의 이어지는 페이지일 수 있으니, 품목을 한 번씩만 모아 주세요.

품목마다 품목명, 수량, 단위, 공급가(공급가액), 세액, 단가를 읽어 주세요.
- 거래명세표에 "공급가액"과 "세액" 칸이 따로 있으면 line_total에 공급가액, tax에 세액을 넣어 주세요.
- 세액 칸이 없는 영수증이면 line_total에 그 줄 금액을 넣고 tax는 null로 두세요.
- 사진에 적힌 그대로 읽고, 보이지 않거나 확실하지 않은 값은 추측하지 말고 null로 두고 notes에 적어 주세요.
- 금액은 원 단위 숫자만 (쉼표·"원" 없이).
- 날짜는 YYYY-MM-DD 형식.
- 공급가액·부가세·합계 줄은 items에 넣지 말고, 전표의 최종 합계만 total_amount에 넣어 주세요.
이 값은 사람이 사진과 대조해 확인한 뒤에만 기록됩니다.${hints ? `\n\n${hints}` : ''}`
}

const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const
type MediaType = (typeof MEDIA_TYPES)[number]

function mediaTypeOf(path: string, blobType: string): MediaType {
  if ((MEDIA_TYPES as readonly string[]).includes(blobType)) return blobType as MediaType
  if (path.endsWith('.png')) return 'image/png'
  if (path.endsWith('.webp')) return 'image/webp'
  return 'image/jpeg'
}

function describeError(err: unknown) {
  if (err instanceof Anthropic.AuthenticationError) return 'AI 키(ANTHROPIC_API_KEY)가 올바르지 않습니다.'
  if (err instanceof Anthropic.RateLimitError) return 'AI 요청이 많습니다. 잠시 후 [다시 읽기]를 누르세요.'
  if (err instanceof Anthropic.BadRequestError) return `AI가 요청을 처리하지 못했습니다: ${err.message}`
  if (err instanceof Anthropic.APIError) return `AI 서버 오류 (${err.status}). 잠시 후 [다시 읽기]를 누르세요.`
  return err instanceof Error ? err.message : 'AI 읽기 중 알 수 없는 오류'
}

// 전표 사진을 Claude로 읽어서 "제안"으로 저장. 응답 후 백그라운드(after)에서 실행.
export async function readReceipt(receiptId: number) {
  const admin = createAdminClient()
  const { data: receipt } = await admin.from('receipts').select('id, photo_paths, status').eq('id', receiptId).single()
  if (!receipt || receipt.status !== 'processing') return

  const save = (values: Record<string, unknown>) =>
    admin
      .from('receipts')
      .update({ ...values, ai_at: new Date().toISOString() })
      .eq('id', receiptId)
      .eq('status', 'processing')

  if (!process.env.ANTHROPIC_API_KEY) {
    await save({
      status: 'failed',
      ai_error: 'AI 키(ANTHROPIC_API_KEY)가 아직 설정되지 않았습니다. 직접 입력해서 확정할 수 있습니다.',
    })
    await notifyAdmins({
      kind: 'receipt',
      title: '전표 확인 대기',
      body: `전표 #${receiptId}를 직접 입력해 확정해 주세요 (AI 키 미설정).`,
      url: `/admin/receipts/${receiptId}`,
    })
    return
  }

  try {
    const images: Anthropic.Beta.BetaImageBlockParam[] = await Promise.all(
      (receipt.photo_paths as string[]).map(async (path) => {
        const { data, error } = await admin.storage.from(RECEIPT_BUCKET).download(path)
        if (error || !data) throw new Error('전표 사진을 불러오지 못했습니다.')
        return {
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: mediaTypeOf(path, data.type),
            data: Buffer.from(await data.arrayBuffer()).toString('base64'),
          },
        }
      }),
    )

    // 지난 확정 품목·고친 예 (이걸로 같은 이름·단위로 읽게 함)
    const hints = await learningHints().catch(() => '')
    const client = new Anthropic()
    const response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: 'medium', format: betaZodOutputFormat(ReceiptProposalSchema) },
      messages: [{ role: 'user', content: [...images, { type: 'text', text: prompt(images.length, hints) }] }],
    })

    if (response.stop_reason === 'refusal') {
      await save({
        status: 'failed',
        ai_model: response.model,
        ai_error: 'AI가 이 사진을 읽지 않았습니다. 직접 입력해서 확정하세요.',
      })
      return
    }
    if (response.stop_reason === 'max_tokens' || !response.parsed_output) {
      await save({
        status: 'failed',
        ai_model: response.model,
        ai_error: 'AI 결과가 완전하지 않습니다. [다시 읽기]를 누르거나 직접 입력하세요.',
      })
      return
    }

    await save({ status: 'proposed', proposal: response.parsed_output, ai_model: response.model, ai_error: null })
  } catch (err) {
    await save({ status: 'failed', ai_model: MODEL, ai_error: describeError(err) })
  }

  // 결과와 상관없이 확인 대기 상태가 되었으니 알림
  await notifyAdmins({
    kind: 'receipt',
    title: '전표 확인 대기',
    body: `전표 #${receiptId}를 사진과 대조해 확정해 주세요.`,
    url: `/admin/receipts/${receiptId}`,
  })
}
