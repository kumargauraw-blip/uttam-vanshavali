import express from "express";
import path from "node:path";
import { z } from "zod";
import { createServer as createViteServer } from "vite";
import { authSchemas, authStore } from "./auth.js";
import { appConfig } from "./config.js";
import { inviteCreateSchema, lineagePersonInputSchema, lineageStore, lineageTreeCreateSchema, lineageTreeInputSchema } from "./lineage.js";

const app = express();
const port = Number(process.env.PORT ?? 5373);

app.use(express.json({ limit: "10mb" }));

function routeId(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0];
  if (!value) throw new Error("Missing route id.");
  return value;
}

function asyncRoute(handler: express.RequestHandler): express.RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

type AuthenticatedRequest = express.Request & {
  auth: NonNullable<ReturnType<typeof authStore.authenticate>>;
};

function tokenFromRequest(req: express.Request) {
  const header = req.headers.authorization ?? "";
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : null;
}

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const auth = authStore.authenticate(tokenFromRequest(req));
  if (!auth) {
    res.status(401).json({ error: "Please sign in again." });
    return;
  }
  (req as AuthenticatedRequest).auth = auth;
  next();
}

app.post("/api/auth/request-code", asyncRoute(async (req, res) => {
  const parsed = authSchemas.email.parse(req.body ?? {});
  const result = authStore.requestAccessCode(parsed.email, parsed.name);
  res.json({
    email: result.account.email,
    expiresInMinutes: result.expiresInMinutes,
    developmentCode: appConfig.isProduction ? undefined : result.code
  });
}));

app.post("/api/auth/verify-code", asyncRoute(async (req, res) => {
  const parsed = authSchemas.verifyCode.parse(req.body ?? {});
  const session = authStore.verifyAccessCode(parsed.email, parsed.code);
  res.json({ ...session, state: lineageStore.stateForAccount(session.account.id) });
}));

app.post("/api/auth/register-password", asyncRoute(async (req, res) => {
  const parsed = authSchemas.registerPassword.parse(req.body ?? {});
  const session = authStore.registerPassword(parsed.email, parsed.name, parsed.password);
  res.json({ ...session, state: lineageStore.stateForAccount(session.account.id) });
}));

app.post("/api/auth/login-password", asyncRoute(async (req, res) => {
  const parsed = authSchemas.loginPassword.parse(req.body ?? {});
  const session = authStore.loginPassword(parsed.email, parsed.password);
  res.json({ ...session, state: lineageStore.stateForAccount(session.account.id) });
}));

app.get("/api/auth/me", requireAuth, (req, res) => {
  const auth = (req as AuthenticatedRequest).auth;
  res.json({
    account: auth.account,
    maxTreesPerAccount: appConfig.maxTreesPerAccount,
    state: lineageStore.stateForAccount(auth.account.id)
  });
});

app.post("/api/auth/change-password", requireAuth, asyncRoute(async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth;
  const parsed = authSchemas.changePassword.parse(req.body ?? {});
  res.json({ account: authStore.changePassword(auth.account.id, parsed.currentPassword, parsed.newPassword) });
}));

app.post("/api/invites/accept", requireAuth, asyncRoute(async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth;
  const token = z.string().min(20).parse(req.body?.token ?? "");
  res.json(lineageStore.acceptInvite(auth.account.id, auth.account.email, token));
}));

app.get("/api/lineage/state", requireAuth, (req, res) => {
  const auth = (req as AuthenticatedRequest).auth;
  const treeId = typeof req.query.treeId === "string" ? req.query.treeId : undefined;
  res.json(lineageStore.stateForAccount(auth.account.id, treeId));
});

app.post(
  "/api/lineage/trees",
  requireAuth,
  asyncRoute(async (req, res) => {
    const auth = (req as AuthenticatedRequest).auth;
    const parsed = lineageTreeCreateSchema.parse(req.body ?? {});
    res.json(lineageStore.createTree(parsed, auth.account.id, appConfig.maxTreesPerAccount));
  })
);

app.patch(
  "/api/lineage/trees/:id",
  requireAuth,
  asyncRoute(async (req, res) => {
    const auth = (req as AuthenticatedRequest).auth;
    const treeId = routeId(req.params.id);
    lineageStore.assertTreeEditAccess(auth.account.id, treeId);
    const parsed = lineageTreeInputSchema.parse(req.body ?? {});
    lineageStore.updateTree(treeId, parsed);
    res.json(lineageStore.stateForAccount(auth.account.id, treeId));
  })
);

app.post(
  "/api/lineage/people",
  requireAuth,
  asyncRoute(async (req, res) => {
    const auth = (req as AuthenticatedRequest).auth;
    const parsed = lineagePersonInputSchema.parse(req.body ?? {});
    if (!parsed.treeId) {
      res.status(400).json({ error: "treeId is required." });
      return;
    }
    lineageStore.assertTreeEditAccess(auth.account.id, parsed.treeId);
    const person = lineageStore.createPerson(parsed);
    res.json({ person, state: lineageStore.stateForAccount(auth.account.id, person.treeId) });
  })
);

app.patch(
  "/api/lineage/people/:id",
  requireAuth,
  asyncRoute(async (req, res) => {
    const auth = (req as AuthenticatedRequest).auth;
    const currentTreeId = lineageStore.personTreeId(routeId(req.params.id));
    lineageStore.assertTreeEditAccess(auth.account.id, currentTreeId);
    const person = lineageStore.updatePerson(routeId(req.params.id), req.body ?? {});
    res.json({ person, state: lineageStore.stateForAccount(auth.account.id, person.treeId) });
  })
);

app.delete(
  "/api/lineage/people/:id",
  requireAuth,
  asyncRoute(async (req, res) => {
    const auth = (req as AuthenticatedRequest).auth;
    const treeId = lineageStore.personTreeId(routeId(req.params.id));
    lineageStore.assertTreeEditAccess(auth.account.id, treeId);
    lineageStore.deletePerson(routeId(req.params.id));
    res.json(lineageStore.stateForAccount(auth.account.id, treeId));
  })
);

app.post(
  "/api/lineage/spouses",
  requireAuth,
  asyncRoute(async (req, res) => {
    const auth = (req as AuthenticatedRequest).auth;
    const treeId = String(req.body?.treeId ?? "");
    const personAId = String(req.body?.personAId ?? "");
    const personBId = String(req.body?.personBId ?? "");
    if (!treeId || !personAId || !personBId) {
      res.status(400).json({ error: "treeId, personAId, and personBId are required." });
      return;
    }
    lineageStore.assertTreeEditAccess(auth.account.id, treeId);
    lineageStore.linkSpouses(treeId, personAId, personBId, String(req.body?.status ?? "married"));
    res.json(lineageStore.stateForAccount(auth.account.id, treeId));
  })
);

app.post(
  "/api/lineage/import/preview",
  requireAuth,
  asyncRoute(async (req, res) => {
    const auth = (req as AuthenticatedRequest).auth;
    const treeId = String(req.body?.treeId ?? "");
    const csv = String(req.body?.csv ?? "");
    if (!treeId || !csv.trim()) {
      res.status(400).json({ error: "treeId and csv are required." });
      return;
    }
    lineageStore.assertTreeAccess(auth.account.id, treeId);
    res.json(lineageStore.csvPreview(treeId, csv));
  })
);

app.post(
  "/api/lineage/import/commit",
  requireAuth,
  asyncRoute(async (req, res) => {
    const auth = (req as AuthenticatedRequest).auth;
    const treeId = String(req.body?.treeId ?? "");
    const csv = String(req.body?.csv ?? "");
    if (!treeId || !csv.trim()) {
      res.status(400).json({ error: "treeId and csv are required." });
      return;
    }
    lineageStore.assertTreeEditAccess(auth.account.id, treeId);
    lineageStore.commitCsv(treeId, csv);
    res.json(lineageStore.stateForAccount(auth.account.id, treeId));
  })
);

app.post(
  "/api/lineage/telegram",
  requireAuth,
  asyncRoute(async (req, res) => {
    const auth = (req as AuthenticatedRequest).auth;
    const treeId = String(req.body?.treeId ?? "");
    const rawText = String(req.body?.rawText ?? "");
    const sourceType = req.body?.sourceType === "telegram_voice" ? "telegram_voice" : "telegram_text";
    if (!treeId || !rawText.trim()) {
      res.status(400).json({ error: "treeId and rawText are required." });
      return;
    }
    lineageStore.assertTreeEditAccess(auth.account.id, treeId);
    res.json({ proposal: lineageStore.createTelegramProposal(treeId, rawText, sourceType), state: lineageStore.stateForAccount(auth.account.id, treeId) });
  })
);

app.post(
  "/api/lineage/proposals/:id/commit",
  requireAuth,
  asyncRoute(async (req, res) => {
    const auth = (req as AuthenticatedRequest).auth;
    const proposalId = routeId(req.params.id);
    const treeId = lineageStore.proposalTreeId(proposalId);
    lineageStore.assertTreeEditAccess(auth.account.id, treeId);
    lineageStore.commitProposal(proposalId);
    res.json(lineageStore.stateForAccount(auth.account.id, treeId));
  })
);

app.get(
  "/api/lineage/trees/:id/access",
  requireAuth,
  asyncRoute(async (req, res) => {
    const auth = (req as AuthenticatedRequest).auth;
    res.json(lineageStore.listTreeAccess(auth.account.id, routeId(req.params.id)));
  })
);

app.post(
  "/api/lineage/trees/:id/invites",
  requireAuth,
  asyncRoute(async (req, res) => {
    const auth = (req as AuthenticatedRequest).auth;
    const parsed = inviteCreateSchema.parse(req.body ?? {});
    const origin = appConfig.appOrigin ?? `${req.protocol}://${req.get("host")}`;
    res.json(lineageStore.createInvite(auth.account.id, routeId(req.params.id), parsed, origin));
  })
);

app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);
  const statusCode = typeof (error as Error & { statusCode?: unknown }).statusCode === "number"
    ? (error as Error & { statusCode: number }).statusCode
    : error instanceof z.ZodError
      ? 400
      : 500;
  res.status(statusCode).json({ error: error.message });
});

if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.resolve("dist/client")));
  app.get("*", (_req, res) => res.sendFile(path.resolve("dist/client/index.html")));
} else {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
    root: path.resolve(".")
  });
  app.use(vite.middlewares);
}

app.listen(port, () => {
  console.log(`Family lineage app running on port ${port}`);
});
