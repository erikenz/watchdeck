import { expect, test } from "@playwright/test";

import { parseIdentity, probeAccounts } from "../backend/inner-tube";

/** Trimmed from a real `account/accounts_list` answer. */
const identityFixture = (handle: string, byline: string) => ({
  actions: [
    {
      getMultiPageMenuAction: {
        menu: {
          multiPageMenuRenderer: {
            sections: [
              {
                items: [
                  {
                    accountByline: { simpleText: byline },
                    accountName: { simpleText: "Example Person" },
                    channelHandle: { simpleText: handle },
                    isSelected: true,
                    serviceEndpoint: { selectActiveIdentityEndpoint: {} },
                  },
                ],
              },
            ],
          },
        },
      },
    },
  ],
});

test("an identity is read out of the switcher's response", () => {
  const identity = parseIdentity(
    identityFixture("@channel-two", "1.2K subscribers")
  );

  expect(identity?.handle).toBe("@channel-two");
  expect(identity?.name).toBe("Example Person");
  expect(identity?.byline).toBe("1.2K subscribers");
  expect(identity?.selected).toBe(true);
  expect(parseIdentity({ actions: [] })).toBeUndefined();
});

test("probeAccounts keeps the indices that answer and stops after two misses", async () => {
  // A session with two identities at 0 and 1, and nothing above.
  const answers: Record<number, unknown> = {
    0: identityFixture("@channel-one", "No subscribers"),
    1: identityFixture("@channel-two", "1.2K subscribers"),
  };
  const asked: number[] = [];

  const found = await probeAccounts(async (index) => {
    asked.push(index);
    const data = answers[index];
    return data ? parseIdentity(data) : undefined;
  });

  expect(asked).toEqual([0, 1, 2, 3]);
  expect(found.map((entry) => entry.index)).toEqual([0, 1]);
  expect(found.map((entry) => entry.identity.handle)).toEqual([
    "@channel-one",
    "@channel-two",
  ]);
});

test("probeAccounts binds the index the header asked about", async () => {
  // Only index 1 answers: the identity must carry index 1, not 0.
  const found = await probeAccounts(async (index) =>
    index === 1
      ? parseIdentity(identityFixture("@channel-two", "1.2K subscribers"))
      : undefined
  );

  expect(found).toEqual([
    {
      identity: expect.objectContaining({ handle: "@channel-two" }),
      index: 1,
    },
  ]);
});
