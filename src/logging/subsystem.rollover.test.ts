import { beforeEach, describe, expect, it, vi } from "vitest";

const getChildLogger = vi.hoisted(() => vi.fn());
const isFileLogLevelEnabled = vi.hoisted(() => vi.fn(() => true));

vi.mock("./logger.js", () => ({
  getChildLogger,
  isFileLogLevelEnabled,
}));

vi.mock("./console.js", () => ({
  formatConsoleTimestamp: () => "",
  getConsoleSettings: () => ({ level: "silent", style: "compact" }),
  shouldLogSubsystemToConsole: () => false,
}));

vi.mock("../global-state.js", () => ({
  isVerbose: () => false,
}));

vi.mock("../terminal/progress-line.js", () => ({
  clearActiveProgressLine: () => {},
}));

vi.mock("../utils/message-channel.js", () => ({
  normalizeMessageChannel: (value: string) => value,
}));

import { createSubsystemLogger } from "./subsystem.js";

describe("createSubsystemLogger file rollover", () => {
  beforeEach(() => {
    getChildLogger.mockReset();
    isFileLogLevelEnabled.mockReset();
    isFileLogLevelEnabled.mockReturnValue(true);
  });

  it("refreshes the child file logger for each write so rolling files can change", () => {
    const firstFileLogger = { info: vi.fn() };
    const secondFileLogger = { info: vi.fn() };
    getChildLogger
      .mockReturnValueOnce(firstFileLogger as never)
      .mockReturnValueOnce(secondFileLogger as never);

    const log = createSubsystemLogger("diagnostic");

    log.info("first log line");
    log.info("second log line");

    expect(getChildLogger).toHaveBeenCalledTimes(2);
    expect(firstFileLogger.info).toHaveBeenCalledWith("first log line");
    expect(secondFileLogger.info).toHaveBeenCalledWith("second log line");
  });
});
