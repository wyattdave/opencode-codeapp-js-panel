import { Rpc } from '@opencode/plugin/rpc';

export const Cap = Rpc.define(/** @type {const} */ ({
  id: 'codeapp-js',
  events: {},
  methods: {
    project: {
      input: { type: 'object', additionalProperties: false },
      output: { type: 'object', properties: { isCodeApp: { type: 'boolean' } }, required: ['isCodeApp'], additionalProperties: false },
    },
    execute: {
      input: {
        type: 'object',
        properties: {
          name: { type: 'string', enum: ['sign-in', 'change-account', 'sign-out', 'skills', 'deploy', 'debugger', 'add-dataverse', 'add-connector', 'add-flow', 'add-environment-variable', 'create-table', 'list-mockups', 'import', 'setup', 'change-environment'] },
          input: { type: 'object' },
        },
        required: ['name', 'input'], additionalProperties: false,
      },
      output: { type: 'string' },
    },
    list: {
      input: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['environments', 'tables', 'connectors', 'flows', 'apps', 'mockups', 'skills'] },
          environment: { type: 'string' }, cloud: { type: 'string' },
        },
        required: ['kind'], additionalProperties: false,
      },
      output: {
        type: 'array', items: {
          type: 'object', properties: { value: { type: 'string' }, label: { type: 'string' }, detail: { type: 'string' } },
          required: ['value', 'label', 'detail'], additionalProperties: false,
        },
      },
    },
  },
}));
