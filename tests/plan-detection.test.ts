import { describe, it, expect } from 'vitest'
import { detectPlanInResponse } from '../src/core/claude-client.js'

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
