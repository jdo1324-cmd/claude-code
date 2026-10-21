import 'server-only'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export type Role = 'owner' | 'manager' | 'staff'
export type EmploymentType = 'full_time' | 'part_time'

export type Profile = {
  id: string
  email: string
  full_name: string
  role: Role
  employment_type: EmploymentType
  is_active: boolean
  created_at: string
}

export const getCurrentProfile = cache(async (): Promise<Profile> => {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  const userId = data?.claims.sub
  if (!userId) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', userId).single()
  if (!profile || !profile.is_active) redirect('/auth/signout?reason=inactive')

  return profile as Profile
})

export function isAdmin(role: Role) {
  return role === 'owner' || role === 'manager'
}

// 사장/관리자 전용 페이지
export async function requireAdmin() {
  const profile = await getCurrentProfile()
  if (!isAdmin(profile.role)) redirect('/')
  return profile
}

// 사장 전용 기능 (계정 생성, 권한 변경)
export async function requireOwner() {
  const profile = await getCurrentProfile()
  if (profile.role !== 'owner') redirect('/')
  return profile
}
