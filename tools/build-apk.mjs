/*
 * One command from source to a debug APK.
 *
 *   node tools/build-apk.mjs            # debug
 *   node tools/build-apk.mjs --release  # release (needs a keystore, see README)
 *
 * Steps: build www/ -> cap sync -> gradle assembleDebug -> copy to dist/
 * Uses the bundled JDK 21 in .tools/ when present, because the Capacitor 7
 * Gradle/AGP combo does not run on JDK 25.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const release = process.argv.includes('--release');
const variant = release ? 'Release' : 'Debug';
const apkName = release ? 'app-release-unsigned.apk' : 'app-debug.apk';

function fail(message) {
  console.error('\n' + message);
  process.exit(1);
}

/** Prefer the project-local JDK 21, then JAVA_HOME if it is 17-23. */
function resolveJavaHome() {
  const tools = path.join(root, '.tools');
  const hasJava = (dir) => fs.existsSync(path.join(dir, 'bin', 'java.exe'));

  if (fs.existsSync(tools)) {
    for (const entry of fs.readdirSync(tools)) {
      if (!entry.toLowerCase().startsWith('jdk')) continue;
      const base = path.join(tools, entry);
      if (!fs.statSync(base).isDirectory()) continue;
      if (hasJava(base)) return base;
      for (const inner of fs.readdirSync(base)) {
        const home = path.join(base, inner);
        if (fs.existsSync(home) && fs.statSync(home).isDirectory() && hasJava(home)) return home;
      }
    }
  }
  if (process.env.JAVA_HOME && fs.existsSync(path.join(process.env.JAVA_HOME, 'bin', 'java.exe'))) {
    return process.env.JAVA_HOME;
  }
  return null;
}

function run(command, args, cwd, env) {
  const isWindows = process.platform === 'win32';
  /* .bat files need cmd.exe; everything else is spawned directly so spaces in
     the executable path ("C:\Program Files\nodejs\node.exe") stay intact */
  const isBatch = isWindows && /\.(bat|cmd)$/i.test(command);
  const file = isBatch ? 'cmd.exe' : command;
  const argv = isBatch ? ['/c', command, ...args] : args;

  const result = spawnSync(file, argv, {
    cwd,
    env: env || process.env,
    stdio: 'inherit'
  });
  if (result.error) fail(command + ': ' + result.error.message);
  if (result.status !== 0) fail(`${command} ${args.join(' ')} failed with code ${result.status}`);
}

const javaHome = resolveJavaHome();
if (!javaHome) {
  fail('No JDK found. Put a JDK 21 under .tools/ or set JAVA_HOME.\n' +
       'Download: https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jdk/hotspot/normal/eclipse');
}

const version = spawnSync(path.join(javaHome, 'bin', 'java.exe'), ['-version'], { encoding: 'utf8' });
const banner = (version.stderr || version.stdout || '').split('\n')[0].trim();
console.log('JDK:    ' + javaHome + '  (' + banner + ')');

const env = {
  ...process.env,
  JAVA_HOME: javaHome,
  PATH: path.join(javaHome, 'bin') + path.delimiter + process.env.PATH,
  ANDROID_HOME: process.env.ANDROID_HOME || path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk')
};

if (!fs.existsSync(path.join(env.ANDROID_HOME, 'platform-tools'))) {
  fail('Android SDK not found at ' + env.ANDROID_HOME + ' (set ANDROID_HOME).');
}
console.log('SDK:    ' + env.ANDROID_HOME);

console.log('\n[1/3] building www/');
run(process.execPath, ['tools/build-web.mjs'], root, env);

console.log('\n[2/3] cap sync android');
const capBin = path.join(root, 'node_modules', '@capacitor', 'cli', 'bin', 'capacitor');
run(process.execPath, [capBin, 'sync', 'android'], root, env);

console.log(`\n[3/3] gradle assemble${variant}`);
const task = release ? 'assembleRelease' : 'assembleDebug';
const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
run(gradlew, [task, '--no-daemon', '--console=plain'], path.join(root, 'android'), env);

const built = path.join(root, 'android', 'app', 'build', 'outputs', 'apk', release ? 'release' : 'debug', apkName);
if (!fs.existsSync(built)) fail('APK not found at ' + built);

const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });
const outName = 'hangman-universal-' + (release ? 'release-unsigned' : 'debug') + '.apk';
const target = path.join(dist, outName);
fs.copyFileSync(built, target);

const mb = (fs.statSync(target).size / (1024 * 1024)).toFixed(1);
console.log('\nAPK: ' + path.relative(root, target) + '  (' + mb + ' MB)');
