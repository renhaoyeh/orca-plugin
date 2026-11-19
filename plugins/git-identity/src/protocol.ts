export type Identity = {
  repoPath: string; configPath: string; name: string; email: string; revision: string;
  nameSource: { scope: string; origin: string }; emailSource: { scope: string; origin: string };
  canSave: boolean; environmentOverride: boolean;
}
export type PushAccount = { host: string; login: string }
export type IdentityState = { workspaceId: string | null; workspaceName: string; identity: Identity | null; problem: string; pushBinding?: (PushAccount & { managed: boolean }) | null }
declare module 'orca' {
  interface PluginRequests {
    'github.bind': { input: { workspaceId: string; repoPath: string; revision: string; account: PushAccount | null }; output: IdentityState }
    'github.accounts': { output: { host: string; login: string; available: boolean }[] }
    'github.author': { input: { host: string; login: string }; output: { name: string; email: string } }
    'identity.read': { input: { locale?: string } | undefined; output: IdentityState }
    'identity.save': { input: { workspaceId: string; repoPath: string; revision: string; name: string; email: string }; output: IdentityState }
  }
}
