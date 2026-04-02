import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerCronAddCommand } from "./register.cron-add.js";

const callGatewayMock = vi.hoisted(() => vi.fn());
vi.mock("../gateway-rpc.js", () => ({
  addGatewayClientOptions: (cmd: Command) => cmd,
  callGatewayFromCli: callGatewayMock,
}));

const warnMock = vi.hoisted(() => vi.fn());
vi.mock("./shared.js", () => ({
  getCronChannelOptions: () => "telegram,whatsapp",
  handleCronCliError: (err: unknown) => {
    throw err;
  },
  printCronJson: vi.fn(),
  printCronList: vi.fn(),
  warnIfCronSchedulerDisabled: warnMock,
}));

describe("cron add --dry-run", () => {
  let program: Command;
  let stdoutOutput: string;

  beforeEach(() => {
    program = new Command().exitOverride();
    program.configureOutput({
      writeOut: (str) => {
        stdoutOutput += str;
      },
      writeErr: () => {},
    });
    stdoutOutput = "";
    callGatewayMock.mockReset();
    warnMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints params JSON and skips RPC when --dry-run is passed", async () => {
    const cron = program.command("cron");
    registerCronAddCommand(cron);

    await program.parseAsync(
      [
        "node",
        "openclaw",
        "cron",
        "add",
        "--name",
        "my-job",
        "--message",
        "hello",
        "--every",
        "1h",
        "--dry-run",
      ],
      { from: "node" },
    );

    expect(callGatewayMock).not.toHaveBeenCalled();
    expect(warnMock).not.toHaveBeenCalled();
    expect(stdoutOutput).toMatch(/Dry run/);
    expect(stdoutOutput).toMatch(/"name":\s*"my-job"/);
    expect(stdoutOutput).toMatch(/"kind":\s*"agentTurn"/);
  });

  it("prints raw JSON when --dry-run --json are both passed", async () => {
    const cron = program.command("cron");
    registerCronAddCommand(cron);

    await program.parseAsync(
      [
        "node",
        "openclaw",
        "cron",
        "add",
        "--name",
        "my-job",
        "--message",
        "hello",
        "--every",
        "1h",
        "--dry-run",
        "--json",
      ],
      { from: "node" },
    );

    expect(callGatewayMock).not.toHaveBeenCalled();
    const parsed = JSON.parse(stdoutOutput);
    expect(parsed).toMatchObject({ name: "my-job" });
  });
});
