import { Prisma } from "@prisma/client";

/** Converts a nullable JS value into a Prisma Json-compatible input,
 * mapping `null`/`undefined` to `Prisma.JsonNull` as Prisma requires. */
export function toNullableJsonInput(
  value: unknown,
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === null || value === undefined) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
}
