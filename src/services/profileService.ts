import sharp from 'sharp';

import {cloudinary} from '../config/cloudinary';
import {logger} from '../config/logger';
import {userRepository} from '../repositories/userRepository';
import {HttpError} from '../utils/httpError';
import {presentUser} from '../utils/userPresenter';

type ProfileInput = {
  name: string;
  username: string;
  bio?: string;
};

const PROFILE_IMAGE_SIZE = 400;

async function resizeForProfile(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .resize(PROFILE_IMAGE_SIZE, PROFILE_IMAGE_SIZE, {fit: 'cover', position: 'centre'})
    .webp({quality: 82})
    .toBuffer();
}

function uploadToCloudinary(buffer: Buffer): Promise<{secure_url: string}> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: 'locator/profile-images',
        resource_type: 'image',
        format: 'webp',
        quality: 'auto',
        overwrite: true,
      },
      (error, result) => {
        if (error || !result) return reject(error ?? new Error('Cloudinary upload failed'));
        resolve(result);
      },
    );
    stream.end(buffer);
  });
}

export const profileService = {
  async update(userId: string, input: ProfileInput) {
    const usernameOwner = await userRepository.findByUsername(input.username);
    if (usernameOwner && usernameOwner.id !== userId) {
      throw new HttpError(409, 'Username is already taken.');
    }

    const user = await userRepository.update(userId, {
      bio: input.bio || null,
      name: input.name,
      username: input.username,
    });

    return presentUser(user);
  },

  async uploadImage(userId: string, file?: Express.Multer.File) {
    if (!file) {
      throw new HttpError(422, 'Profile image is required.');
    }

    const optimizedBuffer = await resizeForProfile(file.buffer);

    let result: {secure_url: string};
    try {
      result = await uploadToCloudinary(optimizedBuffer);
    } catch (err) {
      const cloudinaryError = err as {http_code?: number; message?: string};
      logger.error(
        `[profileService.uploadImage] Cloudinary upload failed for user=${userId}. ` +
          `http_code=${cloudinaryError.http_code ?? 'unknown'} message=${cloudinaryError.message ?? (err as Error).message}`,
      );
      throw new HttpError(502, 'Unable to upload image right now. Please try again shortly.');
    }

    const user = await userRepository.update(userId, {profileImage: result.secure_url});
    return presentUser(user);
  },
};
