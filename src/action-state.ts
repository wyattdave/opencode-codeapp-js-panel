import type { Operation } from './controls'

export function requiredInputsMet(operation: Operation, values: Record<string, string | boolean>) {
  return operation.fields.every((field) => !field.required || String(values[field.key] ?? '').trim().length > 0)
}

export function runsFromButton(operation: Operation) {
  return !operation.fields.some((field) => field.required)
}
