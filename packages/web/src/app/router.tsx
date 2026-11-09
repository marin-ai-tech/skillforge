import { createBrowserRouter } from "react-router";
import { Layout } from "./Layout.tsx";
import { ROUTES } from "./routes.ts";
import { HelpProvider } from "../help/HelpProvider.tsx";
import { Home } from "../pages/Home.tsx";
import { Browse } from "../pages/Browse.tsx";
import { Artifact } from "../pages/Artifact.tsx";
import { NotFound } from "../pages/NotFound.tsx";
import { Publish } from "../pages/Publish.tsx";
import { ImportPage } from "../pages/Import.tsx";
import { Lifecycle } from "../pages/Lifecycle.tsx";
import { Metrics } from "../pages/Metrics.tsx";
import { Login } from "../pages/Login.tsx";
import { Users } from "../pages/admin/Users.tsx";
import { Backups } from "../pages/admin/Backups.tsx";
import { Plugins } from "../pages/admin/Plugins.tsx";
import { ExtPage } from "../pages/ExtPage.tsx";
import { Overview } from "../pages/me/Overview.tsx";
import { Tokens } from "../pages/me/Tokens.tsx";
import { Password } from "../pages/me/Password.tsx";
import { Agents } from "../pages/me/Agents.tsx";
import { Agent } from "../pages/me/Agent.tsx";
import { AdminAgents } from "../pages/admin/Agents.tsx";
import { AdminLifecycle } from "../pages/admin/Lifecycle.tsx";
import { AdminAssistant } from "../pages/admin/Assistant.tsx";
import { AdminAudit } from "../pages/admin/Audit.tsx";
import { AdminReport } from "../pages/admin/Report.tsx";
import { AdminInventory } from "../pages/admin/Inventory.tsx";
import { AdminRollout } from "../pages/admin/Rollout.tsx";
import { AdminHarvest } from "../pages/admin/Harvest.tsx";
import { Packs } from "../pages/Packs.tsx";
import { Help } from "../pages/Help.tsx";
import { Teams } from "../pages/Teams.tsx";
import { Notifications } from "../pages/me/Notifications.tsx";
import { TeamDetail } from "../pages/TeamDetail.tsx";
import { Start } from "../pages/Start.tsx";

function Root() {
  return (
    <HelpProvider>
      <Layout />
    </HelpProvider>
  );
}

export { ROUTES };

export const router = createBrowserRouter([
  {
    path: "/",
    element: <Root />,
    children: [
      { index: true, element: <Home /> },
      { path: "start", element: <Start /> },
      { path: "artifacts", element: <Browse /> },
      { path: "artifacts/:type/:name", element: <Artifact /> },
      { path: "lifecycle", element: <Lifecycle /> },
      { path: "metrics", element: <Metrics /> },
      { path: "publish", element: <Publish /> },
      { path: "import", element: <ImportPage /> },
      { path: "login", element: <Login /> },
      { path: "admin/users", element: <Users /> },
      { path: "admin/backups", element: <Backups /> },
      { path: "admin/plugins", element: <Plugins /> },
      { path: "admin/agents", element: <AdminAgents /> },
      { path: "admin/lifecycle", element: <AdminLifecycle /> },
      { path: "admin/assistant", element: <AdminAssistant /> },
      { path: "admin/audit", element: <AdminAudit /> },
      { path: "admin/report", element: <AdminReport /> },
      { path: "admin/inventory", element: <AdminInventory /> },
      { path: "admin/rollout", element: <AdminRollout /> },
      { path: "admin/harvest", element: <AdminHarvest /> },
      { path: "packs", element: <Packs /> },
      { path: "ext/:plugin/:page", element: <ExtPage /> },
      { path: "me", element: <Overview /> },
      { path: "me/tokens", element: <Tokens /> },
      { path: "me/password", element: <Password /> },
      { path: "me/agents", element: <Agents /> },
      { path: "me/agents/:name", element: <Agent /> },
      { path: "me/notifications", element: <Notifications /> },
      { path: "teams", element: <Teams /> },
      { path: "teams/:name", element: <TeamDetail /> },
      { path: "help", element: <Help /> },
      { path: "help/*", element: <Help /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);
