import { appConfig } from "../config/app-config.js";
import { requireAdmin } from "../auth/auth-middleware.js";
import { getAllUsers, createUser, deleteUser, getUserByUsername } from "../data/users-repository.js";
import { renderView } from "../views.js";

export async function handleGetAdminUsers(request) {
  const authResult = await requireAdmin(request);
  if (authResult instanceof Response) return authResult;
  const user = authResult;

  const users = await getAllUsers();
  const url = new URL(request.url);
  const flash = url.searchParams.get("flash");
  const errorParam = url.searchParams.get("error");

  const flashMessage =
    flash === "created" ? "User created successfully." :
    flash === "deleted" ? "User deleted." :
    null;

  const flashError =
    errorParam === "self-delete" ? "You cannot delete your own account." :
    errorParam === "duplicate" ? "A user with that username already exists." :
    null;

  return renderView("admin/users", {
    title: `${appConfig.companyName} · User Management`,
    companyName: appConfig.companyName,
    companySubtitle: appConfig.companySubtitle,
    currentPath: "/admin/users",
    user,
    users,
    flashMessage,
    flashError
  });
}

export async function handlePostAdminCreateUser(request) {
  const authResult = await requireAdmin(request);
  if (authResult instanceof Response) return authResult;

  let username, password, role;
  try {
    const formData = await request.formData();
    username = (formData.get("username") ?? "").toString().trim();
    password = (formData.get("password") ?? "").toString();
    role = (formData.get("role") ?? "").toString().trim();
  } catch {
    return new Response(null, { status: 302, headers: { Location: "/admin/users" } });
  }

  if (!username || !password || !["admin", "user"].includes(role)) {
    return new Response(null, { status: 302, headers: { Location: "/admin/users" } });
  }

  const existing = await getUserByUsername(username);
  if (existing) {
    return new Response(null, { status: 302, headers: { Location: "/admin/users?error=duplicate" } });
  }

  const passwordHash = await Bun.password.hash(password);
  await createUser(username, passwordHash, role);

  return new Response(null, { status: 302, headers: { Location: "/admin/users?flash=created" } });
}

export async function handlePostAdminDeleteUser(request, userId) {
  const authResult = await requireAdmin(request);
  if (authResult instanceof Response) return authResult;
  const currentUser = authResult;

  if (currentUser.id === userId) {
    return new Response(null, { status: 302, headers: { Location: "/admin/users?error=self-delete" } });
  }

  await deleteUser(userId);
  return new Response(null, { status: 302, headers: { Location: "/admin/users?flash=deleted" } });
}
