import { defineCheck } from 'orca/testing'

export default defineCheck({
  folders: {
    requests: {
      'storage.scan': () => ({
        supported: true,
        folders: [
          { id: 'BuildCache', identity: '1', name: 'BuildCache', size: 8388608, workspace: null, missing: false },
          {
            id: 'Example-cache', identity: '2', name: 'Example', size: 1048576, missing: true,
            workspace: '/private/var/folders/tmp/eas-build-local-nodejs/b548bc22-2d9e-4c89-b3c3-a73e8a3c1382/build/app/ios/Example.xcworkspace',
          },
          {
            id: 'Example-current', identity: '3', name: 'Example', size: 2097152, missing: false,
            workspace: '/Projects/current/app/ios/Example.xcworkspace',
          },
        ],
      }),
    },
  },
  empty: { requests: { 'storage.scan': () => ({ supported: true, folders: [] }) } },
  unsupported: { requests: { 'storage.scan': () => ({ supported: false, folders: [] }) } },
})
