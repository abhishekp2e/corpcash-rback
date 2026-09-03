import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
} from "@nestjs/common";
import type { RBAC } from "@corpcash/rbac-core";
import { StoreNotFoundError, type RBACStore } from "@corpcash/rbac-store";
import {
  createRole,
  findRole,
  isClientError,
  removeRole,
  replaceRole,
  replaceSettings,
  type RoleWriteBody,
} from "../admin/shared.js";
import { RequirePermission } from "./decorators.js";
import { RBAC_INSTANCE, RBAC_STORE } from "./tokens.js";

function rethrow(error: unknown): never {
  if (error instanceof StoreNotFoundError) {
    throw new NotFoundException(error.message);
  }
  if (isClientError(error)) {
    throw new BadRequestException((error as Error).message);
  }
  throw error;
}

@Controller("rbac")
export class RbacAdminController {
  constructor(
    @Inject(RBAC_INSTANCE) private readonly rbac: RBAC,
    @Inject(RBAC_STORE) private readonly store: RBACStore
  ) {}

  @Get("roles")
  @RequirePermission("rbac", "manage")
  listRoles() {
    return this.store.listRoles();
  }

  @Post("roles")
  @RequirePermission("rbac", "manage")
  async create(@Body() body: RoleWriteBody) {
    try {
      return await createRole(this.store, this.rbac, body ?? {});
    } catch (error) {
      rethrow(error);
    }
  }

  @Get("roles/:name")
  @RequirePermission("rbac", "manage")
  async get(@Param("name") name: string) {
    try {
      return await findRole(this.store, name);
    } catch (error) {
      rethrow(error);
    }
  }

  @Put("roles/:name")
  @RequirePermission("rbac", "manage")
  async replace(@Param("name") name: string, @Body() body: RoleWriteBody) {
    try {
      return await replaceRole(this.store, this.rbac, name, body ?? {});
    } catch (error) {
      rethrow(error);
    }
  }

  @Delete("roles/:name")
  @RequirePermission("rbac", "manage")
  async remove(@Param("name") name: string) {
    try {
      await removeRole(this.store, this.rbac, name);
    } catch (error) {
      rethrow(error);
    }
  }

  @Get("subjects/:id/roles")
  @RequirePermission("rbac", "manage")
  async listAssignments(@Param("id") id: string) {
    return {
      subjectId: id,
      roles: await this.store.getRolesForSubject(id),
    };
  }

  @Put("subjects/:id/roles")
  @RequirePermission("rbac", "manage")
  async replaceAssignments(
    @Param("id") id: string,
    @Body() body: { roles?: string[] }
  ) {
    try {
      await this.store.setRolesForSubject(id, body?.roles ?? []);
      return {
        subjectId: id,
        roles: await this.store.getRolesForSubject(id),
      };
    } catch (error) {
      rethrow(error);
    }
  }

  @Post("subjects/:id/roles")
  @RequirePermission("rbac", "manage")
  async assign(@Param("id") id: string, @Body() body: { role?: string }) {
    try {
      await this.store.assignRole(id, body?.role ?? "");
      return {
        subjectId: id,
        roles: await this.store.getRolesForSubject(id),
      };
    } catch (error) {
      rethrow(error);
    }
  }

  @Delete("subjects/:id/roles/:role")
  @RequirePermission("rbac", "manage")
  async revoke(@Param("id") id: string, @Param("role") role: string) {
    await this.store.revokeRole(id, role);
  }

  @Get("settings")
  @RequirePermission("rbac", "manage")
  getSettings() {
    return this.store.getSettings();
  }

  @Patch("settings")
  @RequirePermission("rbac", "manage")
  async patchSettings(@Body() body: { strictRoles?: boolean }) {
    try {
      return await replaceSettings(this.store, this.rbac, body ?? {});
    } catch (error) {
      rethrow(error);
    }
  }
}
