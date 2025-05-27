import { prisma } from "../lib/prisma.js";
export class UserService {
    async createOrUpdateUser(userId) {
        return await prisma.user.upsert({
            create: {
                createdAt: new Date(),
                userId,
            },
            update: {},
            where: { userId },
        });
    }
}
