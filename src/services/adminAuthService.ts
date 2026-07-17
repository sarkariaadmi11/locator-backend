import bcrypt from 'bcrypt';

import {adminRepository} from '../repositories/adminRepository';
import {HttpError} from '../utils/httpError';
import {signAdminToken} from '../utils/jwt';

export const adminAuthService = {
  async login(email: string, password: string) {
    const admin = await adminRepository.findByEmail(email);
    if (!admin) {
      throw new HttpError(401, 'Invalid email or password.');
    }

    const valid = await bcrypt.compare(password, admin.password);
    if (!valid) {
      throw new HttpError(401, 'Invalid email or password.');
    }

    return {
      admin: {id: admin.id, email: admin.email, name: admin.name, role: admin.role},
      token: signAdminToken(admin.id),
    };
  },

  async provision(name: string, email: string, password: string, role: 'MODERATOR' | 'ADMIN' = 'ADMIN') {
    const existing = await adminRepository.findByEmail(email);
    if (existing) {
      throw new HttpError(409, 'Admin with this email already exists.');
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const admin = await adminRepository.create({name, email, password: passwordHash, role});
    return {id: admin.id, email: admin.email, name: admin.name, role: admin.role};
  },
};
