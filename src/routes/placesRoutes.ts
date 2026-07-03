import {Router} from 'express';
import rateLimit, {ipKeyGenerator} from 'express-rate-limit';

import {placesController} from '../controllers/placesController';
import {asyncHandler} from '../middlewares/asyncHandler';
import {authenticate} from '../middlewares/authMiddleware';
import {validate} from '../middlewares/validate';
import {
  addFavoriteBodySchema,
  favoriteIdParamsSchema,
  favoritesQuerySchema,
  historyQuerySchema,
  nearbyQuerySchema,
  placeDetailsParamsSchema,
  reverseGeocodeQuerySchema,
  searchQuerySchema,
} from '../validations/placesValidation';

export const placesRoutes = Router();

placesRoutes.use(authenticate);

// Scoped limiter for the Google-proxying endpoints only — these cost money per call.
// Favorites/history CRUD below is plain DB access and is not subject to this limiter.
const placesApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: req => {
    const userId = (req as unknown as {user?: {id: string}}).user?.id;
    return userId ?? ipKeyGenerator(req.ip ?? 'unknown');
  },
});

placesRoutes.get(
  '/nearby',
  placesApiLimiter,
  validate({query: nearbyQuerySchema}),
  asyncHandler(placesController.nearby),
);
placesRoutes.get(
  '/search',
  placesApiLimiter,
  validate({query: searchQuerySchema}),
  asyncHandler(placesController.search),
);
placesRoutes.get(
  '/details/:id',
  placesApiLimiter,
  validate({params: placeDetailsParamsSchema}),
  asyncHandler(placesController.details),
);
placesRoutes.get(
  '/reverse-geocode',
  placesApiLimiter,
  validate({query: reverseGeocodeQuerySchema}),
  asyncHandler(placesController.reverseGeocode),
);

placesRoutes.post(
  '/favorites',
  validate({body: addFavoriteBodySchema}),
  asyncHandler(placesController.addFavorite),
);
placesRoutes.delete(
  '/favorites/:id',
  validate({params: favoriteIdParamsSchema}),
  asyncHandler(placesController.removeFavorite),
);
placesRoutes.get(
  '/favorites',
  validate({query: favoritesQuerySchema}),
  asyncHandler(placesController.listFavorites),
);

placesRoutes.get('/history', validate({query: historyQuerySchema}), asyncHandler(placesController.listHistory));
placesRoutes.delete('/history', asyncHandler(placesController.clearHistory));
