const MAX_LENGTH = 60
const MAX_PROMPT_CHARS = 1000

/** One line of at most MAX_LENGTH characters from a prompt, or undefined if it holds no title. */
export function titleFrom(prompt: string): string | undefined {
  const text = prompt.replace(/\s+/g, ' ').trim()
  if (text === '' || text.startsWith('/')) return undefined
  return text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH - 1).trimEnd()}…` : text
}

/** The completion that asks a model to title a session from the user's latest prompt. */
export function titleRequest(prompt: string): { system: string; prompt: string } {
  return {
    system:
      'You name chat sessions from the user\'s latest message. Reply with the title only: at most 8 words, ' +
      'or 20 characters in Chinese, in the language of the message, no quotes, no trailing punctuation.',
    prompt: `<message>\n${prompt.slice(0, MAX_PROMPT_CHARS)}\n</message>`,
  }
}

/** A model's reply as a title: its first line without wrapping quotes or trailing punctuation. */
export function titleFromReply(reply: string): string | undefined {
  const line = reply.trim().split('\n')[0] ?? ''
  return titleFrom(line.replace(/^["'“‘「《\s]+|["'”’」》。.!！?？\s]+$/g, ''))
}
