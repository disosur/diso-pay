import { dirname, join } from "node:path";

const root = new URL("..", import.meta.url).pathname;

const vitePackage = Bun.resolveSync("vite/package.json", `${root}apps/processor`);
const viteBin = join(dirname(vitePackage), "bin", "vite.js");

const services = [
  { name: "ledger", cwd: `${root}apps/ledger`, args: ["--watch", "src/index.ts"] },
  { name: "payment", cwd: `${root}apps/payment`, args: ["--watch", "src/index.ts"] },
  { name: "processor", cwd: `${root}apps/processor`, args: [viteBin, "dev"] },
];

const children = services.map((service) => {
  const child = Bun.spawn([process.execPath, ...service.args], {
    cwd: service.cwd,
    env: { ...process.env, FORCE_COLOR: "1" },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  return { ...service, child };
});

let shuttingDown = false;

function signalAll(signal: NodeJS.Signals) {
  for (const { child } of children) {
    if (child.exitCode === null) child.kill(signal);
  }
}

async function shutdown(code: number) {
  if (shuttingDown) return;
  shuttingDown = true;

  signalAll("SIGTERM");

  const forced = setTimeout(() => {
    signalAll("SIGKILL");
    process.exit(code);
  }, 4_000);
  forced.unref?.();

  await Promise.all(children.map(({ child }) => child.exited));
  process.exit(code);
}

process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));

const exits = await Promise.all(
  children.map(async ({ name, child }) => ({ name, code: await child.exited })),
);

const failed = exits.filter((exit) => exit.code !== 0);

if (!shuttingDown) {
  if (failed.length > 0) {
    console.error(
      `services exited: ${failed.map((exit) => `${exit.name}=${exit.code}`).join(", ")}`,
    );
    signalAll("SIGTERM");
    process.exit(1);
  }

  process.exit(0);
}
