export type Locale = "bn" | "en";

export type MessageKey = keyof typeof import("./bn").bn;

export type Messages = Record<MessageKey, string>;
