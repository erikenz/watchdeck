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
                    accountName: { simpleText: "Erik Enz" },
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
  const identity = parseIdentity(identityFixture("@erikenz", "8 subscribers"));

  expect(identity?.handle).toBe("@erikenz");
  expect(identity?.name).toBe("Erik Enz");
  expect(identity?.byline).toBe("8 subscribers");
  expect(identity?.selected).toBe(true);
  expect(parseIdentity({ actions: [] })).toBeUndefined();
});

test("probeAccounts keeps the indices that answer and stops after two misses", async () => {
  // A session with two identities at 0 and 1, and nothing above.
  const answers: Record<number, unknown> = {
    0: identityFixture("@erikenz5372", "No subscribers"),
    1: identityFixture("@erikenz", "8 subscribers"),
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
    "@erikenz5372",
    "@erikenz",
  ]);
});

test("probeAccounts binds the index the header asked about", async () => {
  // Only index 1 answers: the identity must carry index 1, not 0.
  const found = await probeAccounts(async (index) =>
    index === 1
      ? parseIdentity(identityFixture("@erikenz", "8 subscribers"))
      : undefined
  );

  expect(found).toEqual([
    {
      identity: expect.objectContaining({ handle: "@erikenz" }),
      index: 1,
    },
  ]);
});
