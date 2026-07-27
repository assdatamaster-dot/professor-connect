export const FILE_TRANSFER_IPC_CHANNELS = {
  SELECT_FILES: 'teacher:file-transfer:select-files',
  READ_CHUNK: 'teacher:file-transfer:read-chunk',
  VERIFY_SOURCE: 'teacher:file-transfer:verify-source',
  RELEASE_SOURCE: 'teacher:file-transfer:release-source',
  PREPARE_RECEIVE: 'teacher:file-transfer:prepare-receive',
  WRITE_CHUNK: 'teacher:file-transfer:write-chunk',
  COMPLETE_RECEIVE: 'teacher:file-transfer:complete-receive',
  CANCEL_RECEIVE: 'teacher:file-transfer:cancel-receive',
  APPEND_AUDIT: 'teacher:file-transfer:append-audit',
} as const;
