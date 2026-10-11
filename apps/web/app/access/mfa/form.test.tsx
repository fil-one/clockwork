import { StrictMode } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MfaForm } from "./form";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const ready = () =>
  Response.json({ proof: "bound-proof", validForMs: 300_000 });
it("enables code entry only after preparation, preserving the native form binding", async () => {
  let complete: ((value: Response) => void) | undefined;
  const request = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        complete = resolve;
      }),
  );
  vi.stubGlobal("fetch", request);
  const { container } = render(<MfaForm returnTo="/internal/team" />);
  expect(screen.getByLabelText(/code/i)).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Verify and continue" }),
  ).toBeDisabled();
  expect(request).toHaveBeenCalledWith(
    "/access/mfa/prepare",
    expect.objectContaining({
      method: "POST",
      body: "",
      credentials: "same-origin",
    }),
  );
  act(() => {
    complete?.(ready());
  });
  await waitFor(() => expect(screen.getByLabelText(/code/i)).toBeEnabled());
  expect(container.querySelector('input[name="proof"]')).toHaveValue(
    "bound-proof",
  );
  expect(container.querySelector('input[name="returnTo"]')).toHaveValue(
    "/internal/team",
  );
  expect(container.querySelector("form")).toHaveAttribute(
    "action",
    "/access/mfa/verify",
  );
});
it("does not spend a second preparation during Strict Mode effect replay", async () => {
  const request = vi.fn().mockResolvedValue(ready());
  vi.stubGlobal("fetch", request);
  render(
    <StrictMode>
      <MfaForm />
    </StrictMode>,
  );
  await waitFor(() => expect(screen.getByLabelText(/code/i)).toBeEnabled());
  expect(request).toHaveBeenCalledOnce();
});
it("keeps entry disabled when preparation is limited and offers a manual restart", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(Response.json({ error: "limited" }, { status: 429 })),
  );
  render(<MfaForm />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Too many attempts",
  );
  expect(screen.getByLabelText(/code/i)).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Prepare a new verification" }),
  ).toBeEnabled();
});
it("prevents duplicate native submissions without dropping the code field", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ready()));
  const { container } = render(<MfaForm />);
  await waitFor(() => expect(screen.getByLabelText(/code/i)).toBeEnabled());
  const form = container.querySelector("form");
  if (!form) throw new Error("Expected form");
  fireEvent.change(screen.getByLabelText(/code/i), {
    target: { value: "123456" },
  });
  expect(fireEvent.submit(form)).toBe(true);
  expect(screen.getByLabelText(/code/i)).not.toBeDisabled();
  expect(screen.getByLabelText(/code/i)).toHaveAttribute("readonly");
  expect(fireEvent.submit(form)).toBe(false);
  expect(new FormData(form).get("code")).toBe("123456");
});
it("clears an expired preparation without guessing the authenticator countdown", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        Response.json({ proof: "bound-proof", validForMs: 1000 }),
      ),
  );
  render(<MfaForm />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(screen.getByLabelText(/code/i)).toBeEnabled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(screen.getByLabelText(/code/i)).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveTextContent("expired");
});

it("preserves the expired-session explanation when preparation fails", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(Response.json({ error: "expired" }, { status: 503 })),
  );
  render(<MfaForm />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Your session expired",
  );
  expect(screen.getByLabelText(/code/i)).toBeDisabled();
});
it("clears an old preparation error after a fresh challenge is ready", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ready()));
  render(<MfaForm error="preparation" />);
  await waitFor(() => expect(screen.getByLabelText(/code/i)).toBeEnabled());
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
it("bounds a stalled preparation and offers recovery", async () => {
  const controller = new AbortController();
  const timeout = vi
    .spyOn(AbortSignal, "timeout")
    .mockReturnValue(controller.signal);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url, options: RequestInit) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener("abort", () =>
            reject(new Error("timeout")),
          );
        }),
    ),
  );
  try {
    render(<MfaForm />);
    expect(timeout).toHaveBeenCalledWith(20_000);
    act(() => controller.abort());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Verification is unavailable",
    );
    expect(
      screen.getByRole("button", { name: "Prepare a new verification" }),
    ).toBeEnabled();
  } finally {
    timeout.mockRestore();
  }
});
