/**
 * GitOps Package
 * Export all GitOps functionality
 */

export { GitOpsManager } from './gitops-manager';
export { ArgoCDManager } from './argocd/argocd-manager';
export { GitRepository } from './git/git-repository';

export type {
  GitOpsConfig,
  EnvironmentConfig,
  DeploymentRequest,
  DeploymentStatus
} from './gitops-manager';

export type {
  ArgoCDApplicationConfig,
  ArgoCDApplicationStatus,
  ArgoCDApplication
} from './argocd/argocd-manager';

export type {
  GitRepositoryConfig,
  GitCommit
} from './git/git-repository';