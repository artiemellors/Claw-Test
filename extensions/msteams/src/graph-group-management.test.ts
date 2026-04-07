import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../runtime-api.js";
import {
  addParticipantMSTeams,
  removeParticipantMSTeams,
  renameGroupMSTeams,
} from "./graph-group-management.js";

const mockState = vi.hoisted(() => ({
  resolveGraphToken: vi.fn(),
  fetchGraphJson: vi.fn(),
  postGraphJson: vi.fn(),
  deleteGraphRequest: vi.fn(),
  patchGraphJson: vi.fn(),
  findPreferredDmByUserId: vi.fn(),
}));

vi.mock("./graph.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./graph.js")>();
  return {
    ...actual,
    resolveGraphToken: mockState.resolveGraphToken,
    fetchGraphJson: mockState.fetchGraphJson,
    postGraphJson: mockState.postGraphJson,
    deleteGraphRequest: mockState.deleteGraphRequest,
    patchGraphJson: mockState.patchGraphJson,
  };
});

vi.mock("./conversation-store-fs.js", () => ({
  createMSTeamsConversationStoreFs: () => ({
    findPreferredDmByUserId: mockState.findPreferredDmByUserId,
  }),
}));

const TOKEN = "test-graph-token";
const CHAT_ID = "19:abc@thread.tacv2";
const CHANNEL_TO = "team-id-1/channel-id-1";

describe("addParticipantMSTeams", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.resolveGraphToken.mockResolvedValue(TOKEN);
  });

  it("adds member to a chat with empty roles array by default", async () => {
    mockState.postGraphJson.mockResolvedValue({});

    const result = await addParticipantMSTeams({
      cfg: {} as OpenClawConfig,
      to: CHAT_ID,
      userId: "user-aad-id-1",
    });

    expect(result).toEqual({ added: { userId: "user-aad-id-1", chatId: CHAT_ID } });
    expect(mockState.postGraphJson).toHaveBeenCalledWith({
      token: TOKEN,
      path: `/chats/${encodeURIComponent(CHAT_ID)}/members`,
      body: {
        "@odata.type": "#microsoft.graph.aadUserConversationMember",
        roles: [],
        "user@odata.bind": "https://graph.microsoft.com/v1.0/users('user-aad-id-1')",
      },
    });
  });

  it("adds member to a chat with owner role", async () => {
    mockState.postGraphJson.mockResolvedValue({});

    const result = await addParticipantMSTeams({
      cfg: {} as OpenClawConfig,
      to: CHAT_ID,
      userId: "user-aad-id-2",
      role: "owner",
    });

    expect(result).toEqual({ added: { userId: "user-aad-id-2", chatId: CHAT_ID } });
    expect(mockState.postGraphJson).toHaveBeenCalledWith({
      token: TOKEN,
      path: `/chats/${encodeURIComponent(CHAT_ID)}/members`,
      body: {
        "@odata.type": "#microsoft.graph.aadUserConversationMember",
        roles: ["owner"],
        "user@odata.bind": "https://graph.microsoft.com/v1.0/users('user-aad-id-2')",
      },
    });
  });

  it("constructs correct user@odata.bind URL", async () => {
    mockState.postGraphJson.mockResolvedValue({});

    await addParticipantMSTeams({
      cfg: {} as OpenClawConfig,
      to: CHAT_ID,
      userId: "abc-def-123",
    });

    const calledBody = mockState.postGraphJson.mock.calls[0][0].body;
    expect(calledBody["user@odata.bind"]).toBe(
      "https://graph.microsoft.com/v1.0/users('abc-def-123')",
    );
  });

  it("adds member to a channel", async () => {
    mockState.postGraphJson.mockResolvedValue({});

    const result = await addParticipantMSTeams({
      cfg: {} as OpenClawConfig,
      to: CHANNEL_TO,
      userId: "user-aad-id-3",
    });

    expect(result).toEqual({ added: { userId: "user-aad-id-3", chatId: CHANNEL_TO } });
    expect(mockState.postGraphJson).toHaveBeenCalledWith({
      token: TOKEN,
      path: "/teams/team-id-1/channels/channel-id-1/members",
      body: {
        "@odata.type": "#microsoft.graph.aadUserConversationMember",
        roles: [],
        "user@odata.bind": "https://graph.microsoft.com/v1.0/users('user-aad-id-3')",
      },
    });
  });
});

describe("removeParticipantMSTeams", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.resolveGraphToken.mockResolvedValue(TOKEN);
  });

  it("lists members, finds match, deletes by membershipId", async () => {
    mockState.fetchGraphJson.mockResolvedValueOnce({
      value: [
        { id: "membership-1", userId: "user-aad-id-1" },
        { id: "membership-2", userId: "user-aad-id-2" },
      ],
    });
    mockState.deleteGraphRequest.mockResolvedValue(undefined);

    const result = await removeParticipantMSTeams({
      cfg: {} as OpenClawConfig,
      to: CHAT_ID,
      userId: "user-aad-id-2",
    });

    expect(result).toEqual({ removed: { userId: "user-aad-id-2", chatId: CHAT_ID } });
    expect(mockState.fetchGraphJson).toHaveBeenCalledWith({
      token: TOKEN,
      path: `/chats/${encodeURIComponent(CHAT_ID)}/members`,
    });
    expect(mockState.deleteGraphRequest).toHaveBeenCalledWith({
      token: TOKEN,
      path: `/chats/${encodeURIComponent(CHAT_ID)}/members/membership-2`,
    });
  });

  it("throws when user not found in member list", async () => {
    mockState.fetchGraphJson.mockResolvedValueOnce({
      value: [
        { id: "membership-1", userId: "user-aad-id-1" },
        { id: "membership-3", userId: "user-aad-id-3" },
      ],
    });

    await expect(
      removeParticipantMSTeams({
        cfg: {} as OpenClawConfig,
        to: CHAT_ID,
        userId: "user-not-in-list",
      }),
    ).rejects.toThrow("User user-not-in-list is not a member of this conversation");
  });

  it("removes member from a channel", async () => {
    mockState.fetchGraphJson.mockResolvedValueOnce({
      value: [{ id: "membership-5", userId: "user-aad-id-5" }],
    });
    mockState.deleteGraphRequest.mockResolvedValue(undefined);

    const result = await removeParticipantMSTeams({
      cfg: {} as OpenClawConfig,
      to: CHANNEL_TO,
      userId: "user-aad-id-5",
    });

    expect(result).toEqual({ removed: { userId: "user-aad-id-5", chatId: CHANNEL_TO } });
    expect(mockState.fetchGraphJson).toHaveBeenCalledWith({
      token: TOKEN,
      path: "/teams/team-id-1/channels/channel-id-1/members",
    });
    expect(mockState.deleteGraphRequest).toHaveBeenCalledWith({
      token: TOKEN,
      path: "/teams/team-id-1/channels/channel-id-1/members/membership-5",
    });
  });

  it("paginates through @odata.nextLink to find member on a later page", async () => {
    // Page 1: target not found, has nextLink
    mockState.fetchGraphJson.mockResolvedValueOnce({
      value: [
        { id: "m-1", userId: "other-1" },
        { id: "m-2", userId: "other-2" },
      ],
      "@odata.nextLink":
        "https://graph.microsoft.com/v1.0/chats/19%3Aabc%40thread.tacv2/members?$skiptoken=page2",
    });
    // Page 2: target not found, has nextLink
    mockState.fetchGraphJson.mockResolvedValueOnce({
      value: [{ id: "m-3", userId: "other-3" }],
      "@odata.nextLink":
        "https://graph.microsoft.com/v1.0/chats/19%3Aabc%40thread.tacv2/members?$skiptoken=page3",
    });
    // Page 3: target found
    mockState.fetchGraphJson.mockResolvedValueOnce({
      value: [{ id: "m-target", userId: "target-user" }],
    });
    mockState.deleteGraphRequest.mockResolvedValue(undefined);

    const result = await removeParticipantMSTeams({
      cfg: {} as OpenClawConfig,
      to: CHAT_ID,
      userId: "target-user",
    });

    expect(result).toEqual({ removed: { userId: "target-user", chatId: CHAT_ID } });
    expect(mockState.fetchGraphJson).toHaveBeenCalledTimes(3);

    // Verify pagination paths extracted from absolute nextLink URLs
    expect(mockState.fetchGraphJson).toHaveBeenNthCalledWith(2, {
      token: TOKEN,
      path: "/chats/19%3Aabc%40thread.tacv2/members?$skiptoken=page2",
    });
    expect(mockState.fetchGraphJson).toHaveBeenNthCalledWith(3, {
      token: TOKEN,
      path: "/chats/19%3Aabc%40thread.tacv2/members?$skiptoken=page3",
    });

    expect(mockState.deleteGraphRequest).toHaveBeenCalledWith({
      token: TOKEN,
      path: `/chats/${encodeURIComponent(CHAT_ID)}/members/m-target`,
    });
  });

  it("respects the 20-page safety cap", async () => {
    for (let i = 0; i < 20; i++) {
      mockState.fetchGraphJson.mockResolvedValueOnce({
        value: [{ id: `m-${i}`, userId: `other-${i}` }],
        "@odata.nextLink": `https://graph.microsoft.com/v1.0/chats/x/members?$skiptoken=p${i + 1}`,
      });
    }

    await expect(
      removeParticipantMSTeams({
        cfg: {} as OpenClawConfig,
        to: CHAT_ID,
        userId: "missing-user",
      }),
    ).rejects.toThrow("User missing-user is not a member of this conversation");

    // Should stop at exactly 20 pages
    expect(mockState.fetchGraphJson).toHaveBeenCalledTimes(20);
  });
});

describe("renameGroupMSTeams", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.resolveGraphToken.mockResolvedValue(TOKEN);
  });

  it("renames a chat with topic", async () => {
    mockState.patchGraphJson.mockResolvedValue(undefined);

    const result = await renameGroupMSTeams({
      cfg: {} as OpenClawConfig,
      to: CHAT_ID,
      name: "New Chat Name",
    });

    expect(result).toEqual({ renamed: { chatId: CHAT_ID, newName: "New Chat Name" } });
    expect(mockState.patchGraphJson).toHaveBeenCalledWith({
      token: TOKEN,
      path: `/chats/${encodeURIComponent(CHAT_ID)}`,
      body: { topic: "New Chat Name" },
    });
  });

  it("renames a channel with displayName", async () => {
    mockState.patchGraphJson.mockResolvedValue(undefined);

    const result = await renameGroupMSTeams({
      cfg: {} as OpenClawConfig,
      to: CHANNEL_TO,
      name: "New Channel Name",
    });

    expect(result).toEqual({ renamed: { chatId: CHANNEL_TO, newName: "New Channel Name" } });
    expect(mockState.patchGraphJson).toHaveBeenCalledWith({
      token: TOKEN,
      path: "/teams/team-id-1/channels/channel-id-1",
      body: { displayName: "New Channel Name" },
    });
  });
});
