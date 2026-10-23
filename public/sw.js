// 푸시 알림 받기 (사장님 휴대폰)
// 시험 알림(testId 있음)이면 받았는지 / 화면에 띄웠는지를 서버에 알려 줌 → 어디서 막히는지 확인용
function ack(testId, stage, error) {
  if (!testId) return Promise.resolve()
  return fetch('/api/push-ack', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: testId, stage, error }),
  }).catch(() => {})
}

self.addEventListener('push', (event) => {
  let data = { title: '매장 알림', body: '', url: '/admin/home' }
  try {
    data = { ...data, ...event.data.json() }
  } catch {
    if (event.data) data.body = event.data.text()
  }
  event.waitUntil(
    ack(data.testId, 'received')
      .then(() =>
        self.registration.showNotification(data.title, {
          body: data.body,
          icon: '/icon',
          badge: '/icon',
          data: { url: data.url },
          tag: data.testId ? 'push-test' : undefined,
          renotify: !!data.testId,
          requireInteraction: false,
        }),
      )
      .then(() => ack(data.testId, 'shown'))
      .catch((err) => ack(data.testId, 'error', String((err && err.message) || err))),
  )
})

// 알림을 누르면 해당 화면 열기
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(event.notification.data?.url || '/admin/home', self.location.origin).href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate(url)
          return client.focus()
        }
      }
      return self.clients.openWindow(url)
    }),
  )
})
