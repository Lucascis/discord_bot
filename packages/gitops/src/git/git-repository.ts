/**
 * Git Repository Manager
 * Manages Git operations for GitOps workflows
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { logger } from '@discord-bot/logger';
import { EventEmitter } from 'events';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import chokidar from 'chokidar';
import yaml from 'yaml';

const execAsync = promisify(exec);

/**
 * Git Repository Configuration
 */
export interface GitRepositoryConfig {
  url: string;
  branch: string;
  localPath: string;
  credentials?: {
    username: string;
    token: string;
  };
  sshKey?: string;
  watchFiles?: boolean;
  autoCommit?: boolean;
  commitMessage?: string;
}

/**
 * Git Commit Information
 */
export interface GitCommit {
  hash: string;
  author: {
    name: string;
    email: string;
  };
  date: Date;
  message: string;
  files: string[];
}

/**
 * Git Repository Manager
 */
export class GitRepository extends EventEmitter {
  private readonly config: GitRepositoryConfig;
  private watcher?: chokidar.FSWatcher;
  private isWatching = false;
  private lastCommitHash?: string;

  constructor(config: GitRepositoryConfig) {
    super();
    this.config = config;

    logger.info('Git Repository Manager initialized', {
      url: config.url,
      branch: config.branch,
      localPath: config.localPath
    });
  }

  /**
   * Initialize repository
   */
  async initialize(): Promise<void> {
    try {
      // Create local directory if it doesn't exist
      await fs.ensureDir(this.config.localPath);

      // Check if repository already exists
      const gitDir = path.join(this.config.localPath, '.git');
      const repoExists = await fs.pathExists(gitDir);

      if (repoExists) {
        logger.info('Repository already exists, pulling latest changes');
        await this.pull();
      } else {
        logger.info('Cloning repository');
        await this.clone();
      }

      // Get current commit hash
      this.lastCommitHash = await this.getCurrentCommit();

      // Start watching files if enabled
      if (this.config.watchFiles) {
        await this.startWatching();
      }

      logger.info('Git repository initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Git repository:', error);
      throw error;
    }
  }

  /**
   * Clone repository
   */
  async clone(): Promise<void> {
    const cloneUrl = this.buildCloneUrl();
    const args = ['clone', cloneUrl, this.config.localPath, '--branch', this.config.branch];

    try {
      await this.executeGitCommand(args, { cwd: path.dirname(this.config.localPath) });
      logger.info('Repository cloned successfully');
    } catch (error) {
      logger.error('Failed to clone repository:', error);
      throw error;
    }
  }

  /**
   * Pull latest changes
   */
  async pull(): Promise<GitCommit[]> {
    try {
      // Fetch latest changes
      await this.executeGitCommand(['fetch', 'origin', this.config.branch]);

      // Get commits between current and remote
      const currentCommit = await this.getCurrentCommit();
      const remoteCommit = await this.getRemoteCommit();

      const newCommits: GitCommit[] = [];

      if (currentCommit !== remoteCommit) {
        // Get new commits
        const commits = await this.getCommitsBetween(currentCommit, remoteCommit);
        newCommits.push(...commits);

        // Pull changes
        await this.executeGitCommand(['pull', 'origin', this.config.branch]);

        // Update last commit hash
        this.lastCommitHash = remoteCommit;

        logger.info(`Pulled ${newCommits.length} new commits`);
        this.emit('commits-pulled', newCommits);
      }

      return newCommits;
    } catch (error) {
      logger.error('Failed to pull repository:', error);
      throw error;
    }
  }

  /**
   * Push changes
   */
  async push(commitMessage?: string): Promise<void> {
    try {
      // Check if there are changes to commit
      const status = await this.getStatus();
      if (status.modified.length === 0 && status.added.length === 0 && status.deleted.length === 0) {
        logger.info('No changes to push');
        return;
      }

      // Add all changes
      await this.executeGitCommand(['add', '.']);

      // Commit changes
      const message = commitMessage || this.config.commitMessage || 'Update manifests';
      await this.executeGitCommand(['commit', '-m', message]);

      // Push to remote
      await this.executeGitCommand(['push', 'origin', this.config.branch]);

      // Update last commit hash
      this.lastCommitHash = await this.getCurrentCommit();

      logger.info('Changes pushed successfully', { message });
      this.emit('changes-pushed', { message, files: [...status.modified, ...status.added, ...status.deleted] });
    } catch (error) {
      logger.error('Failed to push changes:', error);
      throw error;
    }
  }

  /**
   * Create and push a new commit
   */
  async commitAndPush(
    files: string[],
    message: string,
    options: {
      add?: boolean;
      force?: boolean;
    } = {}
  ): Promise<GitCommit> {
    try {
      // Add specific files or all changes
      if (options.add || files.length === 0) {
        await this.executeGitCommand(['add', '.']);
      } else {
        for (const file of files) {
          await this.executeGitCommand(['add', file]);
        }
      }

      // Check if there are staged changes
      const stagedFiles = await this.getStagedFiles();
      if (stagedFiles.length === 0) {
        throw new Error('No changes to commit');
      }

      // Commit changes
      const commitArgs = ['commit', '-m', message];
      if (options.force) {
        commitArgs.push('--allow-empty');
      }
      await this.executeGitCommand(commitArgs);

      // Get commit information
      const commitHash = await this.getCurrentCommit();
      const commit = await this.getCommitInfo(commitHash);

      // Push to remote
      await this.executeGitCommand(['push', 'origin', this.config.branch]);

      // Update last commit hash
      this.lastCommitHash = commitHash;

      logger.info('Commit created and pushed', {
        hash: commitHash,
        message,
        files: stagedFiles
      });

      this.emit('commit-created', commit);
      return commit;
    } catch (error) {
      logger.error('Failed to commit and push:', error);
      throw error;
    }
  }

  /**
   * Write file to repository
   */
  async writeFile(filePath: string, content: string | Buffer): Promise<void> {
    const fullPath = path.join(this.config.localPath, filePath);

    try {
      // Ensure directory exists
      await fs.ensureDir(path.dirname(fullPath));

      // Write file
      await fs.writeFile(fullPath, content);

      logger.debug(`File written: ${filePath}`);
      this.emit('file-written', { path: filePath, size: content.length });
    } catch (error) {
      logger.error(`Failed to write file: ${filePath}`, error);
      throw error;
    }
  }

  /**
   * Read file from repository
   */
  async readFile(filePath: string): Promise<string> {
    const fullPath = path.join(this.config.localPath, filePath);

    try {
      const content = await fs.readFile(fullPath, 'utf8');
      logger.debug(`File read: ${filePath}`);
      return content;
    } catch (error) {
      logger.error(`Failed to read file: ${filePath}`, error);
      throw error;
    }
  }

  /**
   * Delete file from repository
   */
  async deleteFile(filePath: string): Promise<void> {
    const fullPath = path.join(this.config.localPath, filePath);

    try {
      await fs.remove(fullPath);
      logger.debug(`File deleted: ${filePath}`);
      this.emit('file-deleted', { path: filePath });
    } catch (error) {
      logger.error(`Failed to delete file: ${filePath}`, error);
      throw error;
    }
  }

  /**
   * Write YAML file
   */
  async writeYamlFile(filePath: string, data: any): Promise<void> {
    const yamlContent = yaml.stringify(data, {
      lineWidth: 120,
      indent: 2
    });
    await this.writeFile(filePath, yamlContent);
  }

  /**
   * Read YAML file
   */
  async readYamlFile(filePath: string): Promise<any> {
    const content = await this.readFile(filePath);
    return yaml.parse(content);
  }

  /**
   * Start watching for file changes
   */
  async startWatching(): Promise<void> {
    if (this.isWatching) {
      logger.warn('Git repository is already being watched');
      return;
    }

    this.isWatching = true;

    // Watch for file changes
    this.watcher = chokidar.watch(this.config.localPath, {
      ignored: [
        /(^|[\/\\])\../, // Ignore dotfiles
        /node_modules/,
        /\.git/
      ],
      persistent: true,
      ignoreInitial: true
    });

    this.watcher.on('change', (filePath) => {
      const relativePath = path.relative(this.config.localPath, filePath);
      logger.debug(`File changed: ${relativePath}`);
      this.emit('file-changed', { path: relativePath, type: 'modified' });

      if (this.config.autoCommit) {
        this.autoCommitChanges([relativePath]);
      }
    });

    this.watcher.on('add', (filePath) => {
      const relativePath = path.relative(this.config.localPath, filePath);
      logger.debug(`File added: ${relativePath}`);
      this.emit('file-changed', { path: relativePath, type: 'added' });

      if (this.config.autoCommit) {
        this.autoCommitChanges([relativePath]);
      }
    });

    this.watcher.on('unlink', (filePath) => {
      const relativePath = path.relative(this.config.localPath, filePath);
      logger.debug(`File removed: ${relativePath}`);
      this.emit('file-changed', { path: relativePath, type: 'deleted' });

      if (this.config.autoCommit) {
        this.autoCommitChanges([relativePath]);
      }
    });

    logger.info('Started watching repository for changes');
  }

  /**
   * Stop watching for file changes
   */
  async stopWatching(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = undefined;
    }
    this.isWatching = false;
    logger.info('Stopped watching repository');
  }

  /**
   * Auto-commit changes
   */
  private async autoCommitChanges(files: string[]): Promise<void> {
    try {
      // Debounce commits - wait a bit for more changes
      await new Promise(resolve => setTimeout(resolve, 2000));

      const message = `Auto-commit: Update ${files.join(', ')}`;
      await this.commitAndPush(files, message, { add: true });
    } catch (error) {
      logger.error('Failed to auto-commit changes:', error);
    }
  }

  /**
   * Get repository status
   */
  async getStatus(): Promise<{
    modified: string[];
    added: string[];
    deleted: string[];
    untracked: string[];
  }> {
    try {
      const { stdout } = await this.executeGitCommand(['status', '--porcelain']);

      const status = {
        modified: [] as string[],
        added: [] as string[],
        deleted: [] as string[],
        untracked: [] as string[]
      };

      for (const line of stdout.split('\n')) {
        if (!line.trim()) continue;

        const statusCode = line.slice(0, 2);
        const filePath = line.slice(3);

        if (statusCode.includes('M')) {
          status.modified.push(filePath);
        } else if (statusCode.includes('A')) {
          status.added.push(filePath);
        } else if (statusCode.includes('D')) {
          status.deleted.push(filePath);
        } else if (statusCode.includes('?')) {
          status.untracked.push(filePath);
        }
      }

      return status;
    } catch (error) {
      logger.error('Failed to get repository status:', error);
      throw error;
    }
  }

  /**
   * Get current commit hash
   */
  async getCurrentCommit(): Promise<string> {
    try {
      const { stdout } = await this.executeGitCommand(['rev-parse', 'HEAD']);
      return stdout.trim();
    } catch (error) {
      logger.error('Failed to get current commit:', error);
      throw error;
    }
  }

  /**
   * Get remote commit hash
   */
  async getRemoteCommit(): Promise<string> {
    try {
      const { stdout } = await this.executeGitCommand(['rev-parse', `origin/${this.config.branch}`]);
      return stdout.trim();
    } catch (error) {
      logger.error('Failed to get remote commit:', error);
      throw error;
    }
  }

  /**
   * Get staged files
   */
  async getStagedFiles(): Promise<string[]> {
    try {
      const { stdout } = await this.executeGitCommand(['diff', '--cached', '--name-only']);
      return stdout.trim().split('\n').filter(line => line.trim());
    } catch (error) {
      logger.error('Failed to get staged files:', error);
      throw error;
    }
  }

  /**
   * Get commits between two hashes
   */
  async getCommitsBetween(from: string, to: string): Promise<GitCommit[]> {
    try {
      const { stdout } = await this.executeGitCommand([
        'log',
        `${from}..${to}`,
        '--pretty=format:%H|%an|%ae|%ad|%s',
        '--date=iso',
        '--name-only'
      ]);

      const commits: GitCommit[] = [];
      const commitBlocks = stdout.split('\n\n');

      for (const block of commitBlocks) {
        if (!block.trim()) continue;

        const lines = block.trim().split('\n');
        const [hash, author, email, date, message] = lines[0].split('|');
        const files = lines.slice(1).filter(line => line.trim());

        commits.push({
          hash,
          author: { name: author, email },
          date: new Date(date),
          message,
          files
        });
      }

      return commits;
    } catch (error) {
      logger.error('Failed to get commits between hashes:', error);
      throw error;
    }
  }

  /**
   * Get commit information
   */
  async getCommitInfo(hash: string): Promise<GitCommit> {
    try {
      const { stdout } = await this.executeGitCommand([
        'show',
        '--pretty=format:%H|%an|%ae|%ad|%s',
        '--date=iso',
        '--name-only',
        hash
      ]);

      const lines = stdout.trim().split('\n');
      const [commitHash, author, email, date, message] = lines[0].split('|');
      const files = lines.slice(1).filter(line => line.trim());

      return {
        hash: commitHash,
        author: { name: author, email },
        date: new Date(date),
        message,
        files
      };
    } catch (error) {
      logger.error('Failed to get commit info:', error);
      throw error;
    }
  }

  /**
   * Build clone URL with credentials
   */
  private buildCloneUrl(): string {
    if (this.config.credentials) {
      const { protocol, host, pathname } = new URL(this.config.url);
      return `${protocol}//${this.config.credentials.username}:${this.config.credentials.token}@${host}${pathname}`;
    }
    return this.config.url;
  }

  /**
   * Execute Git command
   */
  private async executeGitCommand(
    args: string[],
    options: { cwd?: string } = {}
  ): Promise<{ stdout: string; stderr: string }> {
    const cwd = options.cwd || this.config.localPath;

    try {
      const { stdout, stderr } = await execAsync(`git ${args.join(' ')}`, { cwd });
      return { stdout, stderr };
    } catch (error: any) {
      logger.error(`Git command failed: git ${args.join(' ')}`, {
        error: error.message,
        stdout: error.stdout,
        stderr: error.stderr
      });
      throw error;
    }
  }

  /**
   * Cleanup resources
   */
  async destroy(): Promise<void> {
    await this.stopWatching();
    logger.info('Git repository manager destroyed');
  }
}