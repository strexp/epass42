/**
 * card42 cross-project harness.
 *
 * Drives a read-only card42 checkout plus the Oracle Java Card simulator from a
 * temporary directory: the harness never writes inside the card42 tree.  It
 * loads the CAPs, personalizes the chip with a `.perso` script produced by the
 * backend, and runs the card42 CLI / `ReadAll` reader against it.
 *
 * Everything is skipped unless `CARD42_E2E=1`; see the README.
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** The card42 locations needed by {@link Card42}. */
export interface Card42Paths {
  root: string
  java: string
  javac: string
  gpJar: string
  gpSh: string
  persoSh: string
  deployConf: string
  simulator: string
  runtimeDir: string
  classpath: string[]
  caps: string[]
}

/** The result of one external command. */
export interface CommandResult {
  code: number
  stdout: string
  stderr: string
}

/** A running simulator process. */
export interface Simulator {
  port: number
  host: string
  log(): string
  stop(): Promise<void>
}

const DEFAULT_ROOT = '/home/yukari/misc/card42'
const DEFAULT_GP_JAR = '/usr/share/java/globalplatformpro/gp.jar'
const SCP_KEYS = {
  kvn: '01',
  enc: '11111111111111111111111111111111',
  mac: '22222222222222222222222222222222',
  dek: '33333333333333333333333333333333',
}

/** The card42 checkout to use (`CARD42`), or the default sibling path. */
export function card42Root(): string {
  return process.env.CARD42 ?? DEFAULT_ROOT
}

/** Locates the simulator runtime shipped with card42. */
function findRuntime(root: string): string | undefined {
  const tools = join(root, 'tools')
  if (!existsSync(tools)) return undefined
  const name = readdirSync(tools).find((entry) => entry.startsWith('java_card_devkit_simulator-'))
  return name ? join(tools, name, 'runtime', 'bin') : undefined
}

/** Resolves every card42 path, or null when the checkout is incomplete. */
export function card42Paths(): Card42Paths | null {
  const root = card42Root()
  const deliverables = join(root, 'build', 'deliverables')
  const runtimeDir = findRuntime(root)
  if (!runtimeDir) return null
  const simulator = join(root, 'build', 'sim', 'jcsl')
  if (!existsSync(simulator)) return null

  const debug = [
    join(deliverables, 'card42-common-debug.cap'),
    join(deliverables, 'card42-emrtd-debug.cap'),
  ]
  const release = [join(deliverables, 'card42-common.cap'), join(deliverables, 'card42-emrtd.cap')]
  const caps = debug.every((path) => existsSync(path)) ? debug : release
  if (!caps.every((path) => existsSync(path))) return null

  const commonJar = join(deliverables, 'card42-common.jar')
  const emrtdJar = join(deliverables, 'card42-emrtd.jar')
  const cliJar = join(deliverables, 'card42-emrtd-cli.jar')
  const socketJar = join(
    root,
    'tools',
    readdirSync(join(root, 'tools')).find((entry) =>
      entry.startsWith('java_card_devkit_simulator-'),
    )!,
    'client',
    'COMService',
    'socketprovider.jar',
  )
  for (const path of [commonJar, emrtdJar, cliJar, socketJar]) {
    if (!existsSync(path)) return null
  }

  const gpJar = process.env.GP_JAR ?? DEFAULT_GP_JAR
  if (!existsSync(gpJar)) return null
  const gpSh = join(root, 'scripts', 'gp.sh')
  const persoSh = join(root, 'scripts', 'perso.sh')
  const deployConf = join(root, 'deploy', 'deploy-emrtd.conf')
  for (const path of [gpSh, persoSh, deployConf]) {
    if (!existsSync(path)) return null
  }

  return {
    root,
    java: process.env.JAVA ?? 'java',
    javac: process.env.JAVAC ?? 'javac',
    gpJar,
    gpSh,
    persoSh,
    deployConf,
    simulator,
    runtimeDir,
    classpath: [commonJar, emrtdJar, cliJar, socketJar],
    caps,
  }
}

/** A free loopback TCP port. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (typeof address === 'object' && address) {
        const port = address.port
        server.close(() => resolve(port))
      } else {
        server.close(() => reject(new Error('could not allocate a port')))
      }
    })
  })
}

/** Runs a command to completion, capturing both streams. */
export async function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
    }, options.timeoutMs ?? 180_000)
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ code: -1, stdout, stderr: `${stderr}\n${error.message}` })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? -1, stdout, stderr })
    })
  })
}

/** Runs a command and throws a readable error on a non-zero exit. */
export async function mustRun(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<CommandResult> {
  const result = await runCommand(command, args, options)
  if (result.code !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} exited ${result.code}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    )
  }
  return result
}

/** Starts a fresh, configured simulator on a free port. */
export async function startSimulator(paths: Card42Paths): Promise<Simulator> {
  const port = await freePort()
  const child = spawn(paths.simulator, [`-p=${port}`], {
    env: {
      ...process.env,
      LD_LIBRARY_PATH: paths.runtimeDir,
      OPENSSL_MODULES: paths.runtimeDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })
  let output = ''
  child.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8')
  })
  child.stderr.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8')
  })

  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (output.includes(`server ready on port #${port}`)) break
    if (child.exitCode !== null) {
      throw new Error(`simulator exited early (${child.exitCode})\n${output}`)
    }
    await sleep(100)
  }
  if (!output.includes(`server ready on port #${port}`)) {
    await stopChild(child, true)
    throw new Error(`simulator did not become ready\n${output}`)
  }

  return {
    port,
    host: `socket:localhost:${port}`,
    log: () => output,
    async stop() {
      await stopChild(child, false)
    },
  }
}

/** Polls the TCP port, then kills the simulator's process group. */
async function stopChild(child: ReturnType<typeof spawn>, force: boolean): Promise<void> {
  if (child.exitCode !== null || child.pid === undefined) return
  try {
    process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM')
  } catch {
    child.kill(force ? 'SIGKILL' : 'SIGTERM')
  }
  const deadline = Date.now() + 5000
  while (child.exitCode === null && Date.now() < deadline) await sleep(50)
  if (child.exitCode === null) {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      /* already gone */
    }
  }
}

/** A temporary workspace for one scenario. */
export interface Card42Workspace {
  dir: string
  /** Absolute path helper inside the workspace. */
  path(name: string): string
}

/** Creates a temporary workspace. */
export function createWorkspace(prefix = 'epass42-card42-'): Card42Workspace {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  return { dir, path: (name) => join(dir, name) }
}

/** The card42 driver: deploy, personalize and read one card. */
export class Card42 {
  constructor(
    readonly paths: Card42Paths,
    readonly simulator: Simulator,
    readonly workspace: Card42Workspace,
  ) {}

  private env(): NodeJS.ProcessEnv {
    return {
      GP_JAVA: this.paths.java,
      GP_JAR: this.paths.gpJar,
      GP_SH: this.paths.gpSh,
      GP_TRANSPORT: transport(this.simulator.port),
    }
  }

  /** Loads the common + eMRTD CAPs and creates the four instances. */
  async deploy(): Promise<CommandResult> {
    const load = await mustRun('bash', [this.paths.gpSh, 'load', ...this.paths.caps], {
      env: this.env(),
      timeoutMs: 180_000,
    })
    const create = await mustRun('bash', [this.paths.gpSh, 'create', this.paths.deployConf], {
      env: {
        ...this.env(),
        EMV_PACKAGE: '434152444202',
        EMRTD_PACKAGE: '434152444202',
        EMRTD_AID: 'A0000002471001',
        EMRTD_PRIVS: 'CardReset',
      },
      timeoutMs: 180_000,
    })
    return { code: 0, stdout: load.stdout + create.stdout, stderr: load.stderr + create.stderr }
  }

  /**
   * Runs the card42 perso exporter and stores its output on the card.  The
   * exporter always loads a DSC certificate/key pair even when the script
   * carries its own `@sod`; any valid X.509/EC pair satisfies it.
   */
  async personalize(
    persoPath: string,
    dsc: { certificatePath: string; keyPath: string },
  ): Promise<CommandResult> {
    return mustRun(
      'bash',
      [
        this.paths.persoSh,
        this.paths.java,
        '-cp',
        this.paths.classpath.join(':'),
        'card42.host.emrtd.tools.EmrtdPersoExporter',
        `-script=${persoPath}`,
        `-dsc=${dsc.certificatePath}`,
        `-dsc-key=${dsc.keyPath}`,
      ],
      { env: this.env(), timeoutMs: 180_000 },
    )
  }

  /** Runs `terminal emrtd <sub>` and returns the raw result. */
  async cli(sub: string, args: string[]): Promise<CommandResult> {
    return runCommand(
      this.paths.java,
      [
        '-cp',
        this.paths.classpath.join(':'),
        'card42.host.emrtd.cli.Main',
        'terminal',
        'emrtd',
        sub,
        `-host=${this.simulator.host}`,
        ...args,
      ],
      { timeoutMs: 120_000 },
    )
  }

  /** Runs a full LDS1 read with PACE/CA/TA/PA and parses its JSON report. */
  async read(options: {
    doc?: string
    dob?: string
    doe?: string
    can?: string
    cscaPath: string
    chainPath: string
    keyHex: string
  }): Promise<{ result: CommandResult; report: Record<string, unknown> }> {
    const args = [
      ...(options.can ? [`-can=${options.can}`] : []),
      ...(options.doc ? [`-doc=${options.doc}`] : []),
      ...(options.dob ? [`-dob=${options.dob}`] : []),
      ...(options.doe ? [`-doe=${options.doe}`] : []),
      ...(options.can ? [] : ['-pace']),
      '-ca',
      '-ta',
      `-ta-chain=${options.chainPath}`,
      `-ta-key=${options.keyHex}`,
      `-csca=${options.cscaPath}`,
      '-json=1',
    ]
    const result = await this.cli('read', args)
    return { result, report: parseJson(result.stdout) }
  }

  /** Runs an LDS2 read and parses its JSON report. */
  async lds2Read(
    app: 'travel' | 'visa' | 'biometrics',
    options: {
      doc?: string
      dob?: string
      doe?: string
      can?: string
      cscaPath: string
      chainPath: string
      keyHex: string
      record?: string
    },
  ): Promise<{ result: CommandResult; report: Lds2Report }> {
    const args = [
      `-app=${app}`,
      ...(options.record ? [`-record=${options.record}`] : []),
      ...(options.can ? [`-can=${options.can}`] : []),
      ...(options.doc ? [`-doc=${options.doc}`] : []),
      ...(options.dob ? [`-dob=${options.dob}`] : []),
      ...(options.doe ? [`-doe=${options.doe}`] : []),
      ...(options.can ? [] : ['-pace']),
      '-ca',
      '-ta',
      `-ta-chain=${options.chainPath}`,
      `-ta-key=${options.keyHex}`,
      `-csca=${options.cscaPath}`,
      '-json=1',
    ]
    const result = await this.cli('lds2', args)
    return { result, report: parseJson(result.stdout) as Lds2Report }
  }

  /** Appends one structured record (certificate/entry/visa/biometrics). */
  async lds2Append(
    app: 'travel' | 'visa' | 'biometrics',
    options: {
      specPath: string
      cscaPath: string
      chainPath: string
      keyHex: string
      can?: string
      doc?: string
      dob?: string
      doe?: string
      signerKeyPath?: string
      certRef?: number
    },
  ): Promise<CommandResult> {
    const args = [
      `-app=${app}`,
      `-append=${options.specPath}`,
      ...(options.can ? [`-can=${options.can}`] : []),
      ...(options.doc ? [`-doc=${options.doc}`] : []),
      ...(options.dob ? [`-dob=${options.dob}`] : []),
      ...(options.doe ? [`-doe=${options.doe}`] : []),
      ...(options.can ? [] : ['-pace']),
      '-ca',
      '-ta',
      `-ta-chain=${options.chainPath}`,
      `-ta-key=${options.keyHex}`,
      `-csca=${options.cscaPath}`,
      ...(options.signerKeyPath ? [`-ts-key=${options.signerKeyPath}`] : []),
      ...(options.certRef !== undefined ? [`-cert-ref=${options.certRef}`] : []),
      '-yes',
      '-json=1',
    ]
    return this.cli('lds2', args)
  }

  /** Compiles and runs the full-LDS1 `ReadAll` reader. */
  async readAll(options: {
    doc: string
    dob: string
    doe: string
    cscaPath: string
    chainPath: string
    keyHex: string
  }): Promise<CommandResult> {
    const classes = this.workspace.path('classes')
    mkdirSync(classes, { recursive: true })
    const source = join(import.meta.dirname, 'java', 'ReadAll.java')
    await mustRun(
      this.paths.javac,
      ['-cp', this.paths.classpath.join(':'), '-d', classes, source],
      { timeoutMs: 120_000 },
    )
    return runCommand(
      this.paths.java,
      [
        '-cp',
        [classes, ...this.paths.classpath].join(':'),
        'ReadAll',
        this.simulator.host,
        options.chainPath,
        options.keyHex,
        options.cscaPath,
        options.doc,
        options.dob,
        options.doe,
      ],
      { timeoutMs: 120_000 },
    )
  }
}

/** The LDS2 JSON report shape (only the fields the tests assert). */
export interface Lds2Report {
  securityInfos?: { type: string; oid: string }[]
  recordFiles?: Record<string, Lds2RecordJson[]>
}

/** One LDS2 record in the JSON report. */
export interface Lds2RecordJson {
  length: number
  tags: string
  hex: string
  parsed: Record<string, unknown>
  verification?: {
    valid: boolean
    signatureValid?: boolean
    profileValid: boolean
    trusted: boolean
    signer: string | null
    problems: string[]
  }
}

/** Parses the CLI's JSON stdout, surfacing the raw output on failure. */
export function parseJson(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error(`expected JSON from the card42 CLI, got:\n${text}`)
  }
}

/** Deletes a workspace after a scenario. */
export function removeWorkspace(workspace: Card42Workspace): void {
  rmSync(workspace.dir, { recursive: true, force: true })
}

/** Reads a text or binary fixture file. */
export function readFixture(path: string): Buffer {
  return readFileSync(path)
}

/** Writes a fixture file and returns its path. */
export function writeFixture(path: string, data: string | Uint8Array): string {
  writeFileSync(path, data)
  return path
}

/** Sleeps for `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** The GlobalPlatformPro simulator transport. */
function transport(port: number): string {
  return [
    '--ng',
    `--simulator localhost:${port}`,
    `--key-enc ${SCP_KEYS.enc}`,
    `--key-mac ${SCP_KEYS.mac}`,
    `--key-dek ${SCP_KEYS.dek}`,
    `--key-ver ${SCP_KEYS.kvn}`,
  ].join(' ')
}

/** Exposed for diagnostics: a one-line description of the toolchain. */
export function describeToolchain(paths: Card42Paths): string {
  return `${paths.java} • ${paths.gpJar} • ${paths.root}`
}
