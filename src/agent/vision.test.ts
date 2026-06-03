import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  createMock: vi.fn(),
}));

vi.mock("../openai/client", () => ({
  openai: { chat: { completions: { create: h.createMock } } },
}));

import { extractTravelInfoFromImage } from "./vision";

describe("extractTravelInfoFromImage", () => {
  it("sends the image and caption to the configured vision model", async () => {
    h.createMock.mockResolvedValueOnce({
      choices: [{ message: { content: "Hotel ABC check-in June 10" } }],
    });

    const result = await extractTravelInfoFromImage({
      image: Buffer.from("image-bytes"),
      mimeType: "image/png",
      caption: "save this hotel",
    });

    expect(result).toBe("Hotel ABC check-in June 10");
    expect(h.createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-4o-mini",
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            content: expect.arrayContaining([
              expect.objectContaining({ type: "text", text: expect.stringContaining("save this hotel") }),
              expect.objectContaining({
                type: "image_url",
                image_url: { url: `data:image/png;base64,${Buffer.from("image-bytes").toString("base64")}` },
              }),
            ]),
          }),
        ]),
      }),
    );
  });
});
