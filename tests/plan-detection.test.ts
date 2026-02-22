import { describe, it, expect } from 'vitest'
import { detectPlanInResponse, getPlanAction } from '../src/core/claude-client.js'

describe('detectPlanInResponse', () => {
  it('returns true when write tools are used', () => {
    expect(detectPlanInResponse('Here is the result.', ['Read', 'Edit'])).toBe(true)
    expect(detectPlanInResponse('Done.', ['Bash'])).toBe(true)
    expect(detectPlanInResponse('Done.', ['Write'])).toBe(true)
    expect(detectPlanInResponse('Done.', ['NotebookEdit'])).toBe(true)
  })

  it('returns false when only read tools are used', () => {
    expect(detectPlanInResponse('Here is the file content.', ['Read'])).toBe(false)
    expect(detectPlanInResponse('Found 3 results.', ['Glob', 'Grep'])).toBe(false)
  })

  it('returns false for no tools and plain response', () => {
    expect(detectPlanInResponse('Hello! How can I help?', [])).toBe(false)
    expect(detectPlanInResponse('The answer is 42.', [])).toBe(false)
  })

  it('detects plan language in response text', () => {
    expect(detectPlanInResponse("I'll create a new file for this.", [])).toBe(true)
    expect(detectPlanInResponse("I will modify the configuration.", [])).toBe(true)
    expect(detectPlanInResponse("I want to delete the old tests.", [])).toBe(true)
    expect(detectPlanInResponse("I'd like to update the README.", [])).toBe(true)
    expect(detectPlanInResponse("I need to run the migration script.", [])).toBe(true)
  })

  it('detects plan/step keywords', () => {
    expect(detectPlanInResponse("Here's my plan:", [])).toBe(true)
    expect(detectPlanInResponse("Here is the implementation plan.", [])).toBe(true)
    expect(detectPlanInResponse("Step 1: Update the config.", [])).toBe(true)
    expect(detectPlanInResponse("Phase 1 involves restructuring.", [])).toBe(true)
  })

  it('returns false for similar but non-matching text', () => {
    expect(detectPlanInResponse('The file was already created.', [])).toBe(false)
    expect(detectPlanInResponse('This is a read-only operation.', [])).toBe(false)
  })
})

describe('getPlanAction', () => {
  describe('plan mode', () => {
    it('returns ask_approval for any write tool', () => {
      expect(getPlanAction('Done.', ['Edit'], 'plan')).toBe('ask_approval')
      expect(getPlanAction('Done.', ['Bash'], 'plan')).toBe('ask_approval')
      expect(getPlanAction('Done.', ['Write'], 'plan')).toBe('ask_approval')
    })

    it('returns ask_approval for plan text patterns', () => {
      expect(getPlanAction("I'll create the file.", [], 'plan')).toBe('ask_approval')
      expect(getPlanAction("Here's my plan:", [], 'plan')).toBe('ask_approval')
    })

    it('returns respond for read-only operations', () => {
      expect(getPlanAction('Here is the content.', ['Read'], 'plan')).toBe('respond')
      expect(getPlanAction('The answer is 42.', [], 'plan')).toBe('respond')
    })
  })

  describe('autoEditApprove mode', () => {
    it('returns auto_execute for edit-only tools', () => {
      expect(getPlanAction('Done.', ['Edit'], 'autoEditApprove')).toBe('auto_execute')
      expect(getPlanAction('Done.', ['Write'], 'autoEditApprove')).toBe('auto_execute')
      expect(getPlanAction('Done.', ['NotebookEdit'], 'autoEditApprove')).toBe('auto_execute')
    })

    it('returns ask_approval when Bash is involved', () => {
      expect(getPlanAction('Done.', ['Bash'], 'autoEditApprove')).toBe('ask_approval')
      expect(getPlanAction('Done.', ['Edit', 'Bash'], 'autoEditApprove')).toBe('ask_approval')
    })

    it('returns auto_execute for plan text patterns without dangerous tools', () => {
      expect(getPlanAction("I'll edit the file.", [], 'autoEditApprove')).toBe('auto_execute')
    })

    it('returns respond for read-only operations', () => {
      expect(getPlanAction('Here is the content.', ['Read'], 'autoEditApprove')).toBe('respond')
      expect(getPlanAction('The answer is 42.', [], 'autoEditApprove')).toBe('respond')
    })
  })

  describe('bypassPermissions mode', () => {
    it('always returns respond regardless of tools', () => {
      expect(getPlanAction('Done.', ['Edit'], 'bypassPermissions')).toBe('respond')
      expect(getPlanAction('Done.', ['Bash'], 'bypassPermissions')).toBe('respond')
      expect(getPlanAction("I'll create the file.", [], 'bypassPermissions')).toBe('respond')
    })
  })
})
