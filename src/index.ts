/** Main plugin entry: mounts the Runtime and provides its restart callback for deployment account changes. */
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { Runtime } from './app/runtime.ts'
import { Config, machineOf, type DeploymentConfig } from './deployment.ts'

// [windows patch] Surface otherwise-silent host failures: the app dies without printing a stack anywhere reachable.
function note(stateDir: string, label: string, detail: unknown): void {
  try {
    mkdirSync(stateDir, { recursive: true })
    const text = detail instanceof Error ? (detail.stack ?? detail.message) : String(detail)
    appendFileSync(join(stateDir, 'windows-port.log'), `[${new Date().toISOString()}] ${label}: ${text}\n`)
  } catch { /* logging must never break startup */ }
}

export const name = 'dsh-superagent'
export const inject = ['agents', 'sessionController', 'sessionPersistence', 'workspaceRegistry', 'permissionPresets', 'tools', 'systemPrompt', 'skills', 'webServer', 'llm', 'subprocess']
export { Config }
export async function apply(ctx: Context, config: DeploymentConfig): Promise<void> {
  const machine = machineOf(config)
  note(machine.stateDir, 'apply', 'enter')
  process.on('unhandledRejection', (reason) => { note(machine.stateDir, 'unhandledRejection', reason) })
  process.on('uncaughtException', (error: unknown) => { note(machine.stateDir, 'uncaughtException', error) })
  // The management panel provides its own settings UI, so disable DSH's auto-generated settings page.
  ctx.inject(['settings'], child => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
  // Volatile limits update in place without a restart; account changes restart dsh-superagent. DSH's settings service stops
  // serving this entry while dsh-superagent restarts and rereads it only on a configuration write, so trigger `describe()`
  // after restart to keep open configuration forms editable without a page reload.
  // TODO: drop the read once DSH's settings service rereads an entry whose plugin becomes active again.
  const restart = (): void => {
    ctx.fiber.restart().then(() => { ctx.get('settings')?.describe() }).catch((error: unknown) => { ctx.logger.error('dsh-superagent restart failed: %s', String(error)) })
  }
  const runtime = new Runtime(ctx, machine, restart)
  ctx.effect(() => async () => { await runtime.stop() })
  try {
    await runtime.ready
  } catch (error) {
    note(machine.stateDir, 'runtime.ready', error)
    throw error
  }
  if (runtime.setupProblem) note(machine.stateDir, 'setupProblem', JSON.stringify(runtime.setupProblem))
  ctx.logger.info(runtime.configured() ? 'dsh-superagent ready; the Superagent sidebar entry opens the management panel' : `dsh-superagent is waiting for setup: ${runtime.setupProblem?.detail ?? ''}`)
}
export type { Deployment, DeploymentConfig } from './deployment.ts'
export * from './core/index.ts'
