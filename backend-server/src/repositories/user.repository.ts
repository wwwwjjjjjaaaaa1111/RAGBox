import { prisma } from "../lib/prisma";

/**
 * 根据用户 ID 查询用户。
 * @param userId 用户 ID。
 * @returns 用户记录；不存在时返回 null。
 */
export async function findUserById(userId: string) {
  return prisma.appUser.findUnique({
    where: { id: userId },
  });
}

/**
 * 根据用户名查询用户。
 * @param username 用户名。
 * @returns 用户记录；不存在时返回 null。
 */
export async function findUserByUsername(username: string) {
  return prisma.appUser.findUnique({
    where: { username },
  });
}
