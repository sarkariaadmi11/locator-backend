import {userRepository} from '../repositories/userRepository';
import {presentUser} from '../utils/userPresenter';

type LocationInput = {
  city?: string;
  latitude?: number;
  longitude?: number;
};

export const locationService = {
  async save(userId: string, input: LocationInput) {
    const user = await userRepository.update(userId, {
      city: input.city ?? null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
    });

    return presentUser(user);
  },
};
