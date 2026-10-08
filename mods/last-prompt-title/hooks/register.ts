import type { Register } from 'claude-code'
import { titleFrom, titleFromReply, titleRequest } from './title'

export const register: Register = on => {
  let latest = 0

  on('classic.UserPromptSubmit', async ($, e, next) => {
    const ran = await next(e)
    if (e.source !== undefined && e.source !== 'user') return ran

    const sessionTitle = titleFrom(e.prompt)
    if (sessionTitle === undefined) return ran

    const request = ++latest

    // The sidebar reads ccd_session_mgmt, not the CLI custom-title record.
    // A terminal session has no such server; the CLI title still applies.
    // Not awaited: the turn starts with the cut title, the model's lands after.
    void $.model
      .complete({ model: 'haiku', effort: 'low', maxTokens: 64, timeoutMs: 15000, ...titleRequest(e.prompt) })
      .then(reply => {
        if (request !== latest) return // a newer prompt's title is on its way
        const title = (reply.isAnswered ? titleFromReply(reply.text) : undefined) ?? sessionTitle
        return $.mcp.call('ccd_session_mgmt', 'set_session_title', { session_id: 'self', title })
      })
      .catch(() => undefined)

    return { ...ran, sessionTitle }
  })
}
