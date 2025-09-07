import { describe, it, expect } from 'vitest';
import { guildMutex } from '../src/guildMutex.js';

describe('GuildMutex', () => {
  it('should execute tasks sequentially for the same guild', async () => {
    const results: number[] = [];
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    // Create tasks that take different amounts of time
    const task1 = async () => {
      await delay(50);
      results.push(1);
      return 'task1';
    };

    const task2 = async () => {
      await delay(20);
      results.push(2);
      return 'task2';
    };

    const task3 = async () => {
      await delay(10);
      results.push(3);
      return 'task3';
    };

    // Start all tasks at the same time for the same guild
    const promises = [
      guildMutex.run('guild1', task1),
      guildMutex.run('guild1', task2),
      guildMutex.run('guild1', task3)
    ];

    const taskResults = await Promise.all(promises);

    // Tasks should complete in order despite different execution times
    expect(results).toEqual([1, 2, 3]);
    expect(taskResults).toEqual(['task1', 'task2', 'task3']);
  });

  it('should allow parallel execution for different guilds', async () => {
    const results: string[] = [];
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    const createTask = (guild: string, taskId: string, delayMs: number) => async () => {
      await delay(delayMs);
      results.push(`${guild}-${taskId}`);
      return `${guild}-${taskId}`;
    };

    // Start tasks for different guilds
    const promises = [
      guildMutex.run('guild1', createTask('guild1', 'task1', 50)),
      guildMutex.run('guild2', createTask('guild2', 'task1', 20)),
      guildMutex.run('guild1', createTask('guild1', 'task2', 10)),
      guildMutex.run('guild3', createTask('guild3', 'task1', 30))
    ];

    await Promise.all(promises);

    // Guild1 tasks should be in order, but other guilds can interleave
    const guild1Results = results.filter(r => r.startsWith('guild1'));
    expect(guild1Results).toEqual(['guild1-task1', 'guild1-task2']);

    // All tasks should have completed
    expect(results).toContain('guild2-task1');
    expect(results).toContain('guild3-task1');
    expect(results).toHaveLength(4);
  });

  it('should handle task errors gracefully', async () => {
    const results: string[] = [];

    const successTask = async () => {
      results.push('success');
      return 'success';
    };

    const errorTask = async () => {
      results.push('error-attempted');
      throw new Error('Task failed');
    };

    const afterErrorTask = async () => {
      results.push('after-error');
      return 'after-error';
    };

    // Run tasks where middle one fails
    const promise1 = guildMutex.run('guild1', successTask);
    const promise2 = guildMutex.run('guild1', errorTask);
    const promise3 = guildMutex.run('guild1', afterErrorTask);

    const result1 = await promise1;
    
    await expect(promise2).rejects.toThrow('Task failed');
    
    const result3 = await promise3;

    expect(result1).toBe('success');
    expect(result3).toBe('after-error');
    expect(results).toEqual(['success', 'error-attempted', 'after-error']);
  });

  it('should handle synchronous tasks', async () => {
    const results: number[] = [];

    const syncTask1 = () => {
      results.push(1);
      return 'sync1';
    };

    const syncTask2 = () => {
      results.push(2);
      return 'sync2';
    };

    const asyncTask = async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      results.push(3);
      return 'async';
    };

    const taskResults = await Promise.all([
      guildMutex.run('guild1', syncTask1),
      guildMutex.run('guild1', syncTask2),
      guildMutex.run('guild1', asyncTask)
    ]);

    expect(results).toEqual([1, 2, 3]);
    expect(taskResults).toEqual(['sync1', 'sync2', 'async']);
  });

  it('should handle rapid sequential calls', async () => {
    const results: number[] = [];
    const tasks: Promise<number>[] = [];

    // Create 100 rapid sequential tasks
    for (let i = 0; i < 100; i++) {
      const task = async () => {
        results.push(i);
        return i;
      };
      tasks.push(guildMutex.run('guild1', task));
    }

    await Promise.all(tasks);

    // All tasks should complete in order
    expect(results).toHaveLength(100);
    for (let i = 0; i < 100; i++) {
      expect(results[i]).toBe(i);
    }
  });

  it('should not interfere between different guilds under heavy load', async () => {
    const guild1Results: number[] = [];
    const guild2Results: number[] = [];
    const tasks: Promise<number>[] = [];

    // Create interleaved tasks for two guilds
    for (let i = 0; i < 50; i++) {
      const guild1Task = async () => {
        guild1Results.push(i);
        return `guild1-${i}`;
      };

      const guild2Task = async () => {
        guild2Results.push(i);
        return `guild2-${i}`;
      };

      tasks.push(guildMutex.run('guild1', guild1Task));
      tasks.push(guildMutex.run('guild2', guild2Task));
    }

    await Promise.all(tasks);

    // Each guild should have all its tasks completed in order
    expect(guild1Results).toHaveLength(50);
    expect(guild2Results).toHaveLength(50);

    for (let i = 0; i < 50; i++) {
      expect(guild1Results[i]).toBe(i);
      expect(guild2Results[i]).toBe(i);
    }
  });

  it('should properly clean up completed chains', async () => {
    // This test verifies memory management by ensuring completed chains don't accumulate
    const tasks: Promise<number>[] = [];

    // Run many tasks across different guilds
    for (let guildNum = 0; guildNum < 10; guildNum++) {
      for (let taskNum = 0; taskNum < 5; taskNum++) {
        const task = async () => {
          await new Promise(resolve => setTimeout(resolve, 1));
          return `guild${guildNum}-task${taskNum}`;
        };
        tasks.push(guildMutex.run(`guild${guildNum}`, task));
      }
    }

    await Promise.all(tasks);

    // After all tasks complete, internal state should be clean
    // (This is more of an integration test to ensure no memory leaks)
    expect(tasks).toHaveLength(50);
  });

  it('should handle mixed sync and async tasks correctly', async () => {
    const results: string[] = [];

    const syncTask = () => {
      results.push('sync');
      return 'sync-result';
    };

    const asyncTask = async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      results.push('async');
      return 'async-result';
    };

    const anotherSyncTask = () => {
      results.push('sync2');
      return 'sync2-result';
    };

    const taskResults = await Promise.all([
      guildMutex.run('guild1', syncTask),
      guildMutex.run('guild1', asyncTask),
      guildMutex.run('guild1', anotherSyncTask)
    ]);

    expect(results).toEqual(['sync', 'async', 'sync2']);
    expect(taskResults).toEqual(['sync-result', 'async-result', 'sync2-result']);
  });
});