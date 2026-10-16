import { getConnInfo } from '@hono/node-server/conninfo';
import { createRoute, z } from '@hono/zod-openapi';
import { dialog } from 'electron';
import { sign } from 'hono/jwt';

import { t } from '@/i18n';
import type { BackendContext } from '@/types/contexts';

import { AuthStrategy } from '../../config';
import type { APIServerConfig } from '../../config';
import type { JWTPayload } from '../scheme';
import type { HonoApp } from '../types';

const routes = {
  request: createRoute({
    description: '',
    method: 'post',
    path: '/auth/{id}',
    request: {
      params: z.object({
        id: z.string(),
      }),
    },
    responses: {
      200: {
        content: {
          'application/json': {
            schema: z.object({
              accessToken: z.string(),
            }),
          },
        },
        description: 'Success',
      },
      403: {
        description: 'Forbidden',
      },
    },
    security: [],
    summary: '',
  }),
};

export const register = (
  app: HonoApp,
  { getConfig, setConfig }: BackendContext<APIServerConfig>,
) => {
  app.openapi(routes.request, async (ctx) => {
    const config = await getConfig();
    const { id } = ctx.req.param();

    if (config.authorizedClients.includes(id)) {
      // SKIP CHECK
    } else if (config.authStrategy === AuthStrategy.AUTH_AT_FIRST) {
      const result = await dialog.showMessageBox({
        buttons: [
          t('plugins.api-server.dialog.request.buttons.allow'),
          t('plugins.api-server.dialog.request.buttons.deny'),
        ],
        cancelId: 1,
        defaultId: 1,
        message: t('plugins.api-server.dialog.request.message', {
          origin: getConnInfo(ctx).remote.address,
          ID: id,
        }),
        title: t('plugins.api-server.dialog.request.title'),
      });

      if (result.response === 1) {
        ctx.status(403);
        return ctx.body(null);
      }
    } else if (config.authStrategy === AuthStrategy.NONE) {
      // SKIP CHECK
    }

    if (!config.authorizedClients.includes(id)) {
      setConfig({
        authorizedClients: [...config.authorizedClients, id],
      });
    }

    const token = await sign(
      {
        iat: ~~(Date.now() / 1000),
        id,
      } satisfies JWTPayload,
      config.secret,
    );

    ctx.status(200);
    return ctx.json({
      accessToken: token,
    });
  });
};
