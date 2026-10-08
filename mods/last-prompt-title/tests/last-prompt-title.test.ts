import { describe, expect, mock, test } from 'claude-code/testing'
import { titleFrom, titleFromReply, titleRequest } from '../hooks/title'

describe('titleFrom', () => {
  test('collapses whitespace into one line', () => {
    expect(titleFrom('  fix\n the   bug ')).toBe('fix the bug')
  })

  test('cuts long prompts with an ellipsis', () => {
    const title = titleFrom('a'.repeat(200))
    expect(title?.length).toBe(60)
    expect(title?.endsWith('…')).toBe(true)
  })

  test('skips empty prompts and slash commands', () => {
    expect(titleFrom('   ')).toBeUndefined()
    expect(titleFrom('/plugin install x')).toBeUndefined()
  })
})

describe('titleRequest / titleFromReply', () => {
  test('wraps the prompt, cut to 1000 characters', () => {
    expect(titleRequest('fix it').prompt).toBe('<message>\nfix it\n</message>')
    expect(titleRequest('a'.repeat(2000)).prompt.length).toBe('<message>\n\n</message>'.length + 1000)
  })

  test('cleans quotes, punctuation and extra lines off a reply', () => {
    expect(titleFromReply('「修复登录 bug」。\nextra')).toBe('修复登录 bug')
    expect(titleFromReply('"Add dark mode."')).toBe('Add dark mode')
    expect(titleFromReply('   ')).toBeUndefined()
  })
})

type Rename = { server: string; tool: string; args: Record<string, unknown> }

describe('classic.UserPromptSubmit', () => {
  test('cuts the CLI title and asks the model for the sidebar title from the latest prompt', async ($, on) => {
    const clock = mock.clock(on)
    const asked: string[] = []
    const renames: Rename[] = []
    on('classic.UserPromptSubmit', () => ({}))
    on('model.complete', async (_$, e) => {
      asked.push(e.prompt)
      return { value: { isAnswered: true, text: `Title ${asked.length}`, usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }
    })
    on('mcp.call', async (_$, e) => {
      renames.push({ server: e.server, tool: e.tool, args: e.args })
      return { value: { content: [], isError: false } }
    })

    let result = await $.classic.UserPromptSubmit({ prompt: 'add a  dark mode\ntoggle', source: 'user' })
    for (const prompt of ['two', 'three', 'four']) {
      result = await $.classic.UserPromptSubmit({ prompt, source: 'user' })
    }
    await clock.settle()

    expect(result.sessionTitle).toBe('four')
    expect(asked.at(-1)).toBe(titleRequest('four').prompt)
    expect(renames.at(-1)).toEqual({
      server: 'ccd_session_mgmt',
      tool: 'set_session_title',
      args: { session_id: 'self', title: 'Title 4' },
    })
  })

  test('falls back to the cut title when the model does not answer', async ($, on) => {
    const clock = mock.clock(on)
    const renames: Rename[] = []
    on('classic.UserPromptSubmit', () => ({}))
    on('model.complete', async () => ({
      value: { isAnswered: false, reason: 'empty-reply', usage: { input_tokens: 1, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
    }))
    on('mcp.call', async (_$, e) => {
      renames.push({ server: e.server, tool: e.tool, args: e.args })
      return { value: { content: [], isError: false } }
    })

    await $.classic.UserPromptSubmit({ prompt: 'fix the bug', source: 'user' })
    await clock.settle()

    expect(renames.at(-1)?.args).toEqual({ session_id: 'self', title: 'fix the bug' })
  })

  test('still titles the CLI when the sidebar server is missing', async ($, on) => {
    on('classic.UserPromptSubmit', () => ({}))
    on('mcp.call', async () => ({ deny: 'no such server' }))
    const result = await $.classic.UserPromptSubmit({ prompt: 'fix the bug', source: 'user' })
    expect(result.sessionTitle).toBe('fix the bug')
  })

  test('leaves machine-injected prompts and slash commands untitled', async ($, on) => {
    on('classic.UserPromptSubmit', () => ({}))
    const injected = await $.classic.UserPromptSubmit({ prompt: 'task finished', source: 'system' })
    const slash = await $.classic.UserPromptSubmit({ prompt: '/reload-plugins', source: 'user' })
    expect(injected.sessionTitle).toBeUndefined()
    expect(slash.sessionTitle).toBeUndefined()
  })
})
