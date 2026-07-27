export const FILE_TRANSFER_IPC_CHANNELS = {
  SELECT_FILES: 'student:file-transfer:select-files',
  READ_CHUNK: 'student:file-transfer:read-chunk',
  VERIFY_SOURCE: 'student:file-transfer:verify-source',
  RELEASE_SOURCE: 'student:file-transfer:release-source',
  PREPARE_RECEIVE: 'student:file-transfer:prepare-receive',
  WRITE_CHUNK: 'student:file-transfer:write-chunk',
  COMPLETE_RECEIVE: 'student:file-transfer:complete-receive',
  CANCEL_RECEIVE: 'student:file-transfer:cancel-receive',
  APPEND_AUDIT: 'student:file-transfer:append-audit',
} as const;
