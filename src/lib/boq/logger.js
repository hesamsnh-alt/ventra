const isDevelopment =
  process.env.NODE_ENV !==
  "production";

function print(
  method,
  label,
  payload
) {
  if (
    method === "debug" &&
    !isDevelopment
  ) {
    return;
  }

  const prefix =
    `[Ventra BOQ] ${label}`;

  if (
    payload === undefined
  ) {
    console[method](prefix);
    return;
  }

  console[method](
    prefix,
    payload
  );
}

export const logger = {
  debug(
    label,
    payload
  ) {
    print(
      "debug",
      label,
      payload
    );
  },

  info(
    label,
    payload
  ) {
    print(
      "info",
      label,
      payload
    );
  },

  warn(
    label,
    payload
  ) {
    print(
      "warn",
      label,
      payload
    );
  },

  error(
    label,
    payload
  ) {
    print(
      "error",
      label,
      payload
    );
  },
};