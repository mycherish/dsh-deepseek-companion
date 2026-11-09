/** Modern keyboard composition fields supported by the Chromium baseline. */
export function shouldSubmitMessage(event: { key: string; shiftKey: boolean; isComposing: boolean }): boolean {
  return event.key === 'Enter' && !event.shiftKey && !event.isComposing
}

export function shouldFollowTranscript(metrics: {
  scrollTop: number
  clientHeight: number
  scrollHeight: number
}): boolean {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <= 32
}

export function uiErrorText(message: string): string {
  if (
    /Call log:|(?:page|locator|browserContext|browser)\.[a-zA-Z]+:|Target (?:page|browser)|Timeout \d+ms exceeded/.test(
      message,
    )
  ) {
    return '操作未完成，请打开 DeepSeek 网页检查状态后重试。'
  }
  return message
}
