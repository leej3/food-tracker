import { useEffect, useState } from "react";
import type { FamilyMember, FoodAccessLevel, MemberAccess, UserDirectoryRow } from "../lib/types";
import { supabase } from "../lib/supabase";
import { getAppErrorMessage } from "../lib/backend";

interface AdminPanelProps {
  members: FamilyMember[];
  onMembersChanged: () => Promise<void>;
}

export const AdminPanel = ({ members, onMembersChanged }: AdminPanelProps) => {
  const [newMemberName, setNewMemberName] = useState("");
  const [memberError, setMemberError] = useState("");
  const [memberSaving, setMemberSaving] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [searchEmail, setSearchEmail] = useState("");
  const [searchResults, setSearchResults] = useState<UserDirectoryRow[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [accessLevel, setAccessLevel] = useState<FoodAccessLevel>("logger");
  const [assignError, setAssignError] = useState("");
  const [memberAccess, setMemberAccess] = useState<MemberAccess[]>([]);
  const [emailMap, setEmailMap] = useState<Record<string, string>>({});

  const loadMemberAccess = async (memberId: string) => {
    const { data, error } = await supabase
      .from("member_access")
      .select("id, member_id, user_id, access_level")
      .eq("member_id", memberId)
      .order("created_at", { ascending: false });

    if (error) {
      setAssignError(getAppErrorMessage(error, "Unable to load access assignments."));
      setMemberAccess([]);
      setEmailMap({});
      return;
    }

    const access = (data ?? []) as MemberAccess[];
    setMemberAccess(access);

    const userIds = access.map((entry) => entry.user_id);
    if (userIds.length === 0) {
      setEmailMap({});
      return;
    }

    const { data: users, error: userError } = await supabase
      .from("user_directory")
      .select("user_id,email")
      .in("user_id", userIds);

    if (userError) {
      setAssignError(getAppErrorMessage(userError, "Unable to load user emails."));
      setEmailMap({});
      return;
    }

    const nextEmailMap: Record<string, string> = {};
    (users ?? []).forEach((entry: { user_id: string; email: string }) => {
      nextEmailMap[entry.user_id] = entry.email;
    });
    setEmailMap(nextEmailMap);
  };

  useEffect(() => {
    if (!selectedMemberId) {
      setMemberAccess([]);
      setEmailMap({});
      return;
    }

    let cancelled = false;
    (async () => {
      if (cancelled) {
        return;
      }
      await loadMemberAccess(selectedMemberId);
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedMemberId]);

  const addMember = async () => {
    setMemberError("");
    if (!newMemberName.trim()) {
      setMemberError("Member name is required.");
      return;
    }

    setMemberSaving(true);
    const { error } = await supabase
      .from("family_members")
      .insert({ name: newMemberName.trim() })
      .select("id")
      .single();

    setMemberSaving(false);
    if (error) {
      setMemberError(getAppErrorMessage(error, "Unable to create person."));
      return;
    }

    setNewMemberName("");
    await onMembersChanged();
  };

  const searchUsers = async () => {
    setAssignError("");
    const term = searchEmail.trim().toLowerCase();
    if (!term) {
      setSearchResults([]);
      return;
    }

    const { data, error } = await supabase.rpc("search_user_directory", {
      p_search: term,
    });
    if (error) {
      setAssignError(getAppErrorMessage(error, "Search failed. Make sure you are an admin."));
      setSearchResults([]);
      return;
    }

    setSearchResults((data ?? []) as UserDirectoryRow[]);
  };

  const grantAccess = async () => {
    setAssignError("");
    if (!selectedMemberId || !selectedUserId) {
      setAssignError("Select a member and a user.");
      return;
    }

    const { error } = await supabase.from("member_access").insert({
      member_id: selectedMemberId,
      user_id: selectedUserId,
      access_level: accessLevel,
    });

    if (error) {
      setAssignError(getAppErrorMessage(error, "Unable to save access. User may already have this assignment."));
      return;
    }

    setSearchEmail("");
    setSearchResults([]);
    setSelectedUserId("");
    await onMembersChanged();
    await loadMemberAccess(selectedMemberId);
  };

  const changeAccess = async (access: MemberAccess, next: FoodAccessLevel) => {
    const { error } = await supabase
      .from("member_access")
      .update({ access_level: next })
      .eq("id", access.id);
    if (error) {
      setAssignError(getAppErrorMessage(error, "Unable to update access."));
      return;
    }
    await onMembersChanged();
    await loadMemberAccess(access.member_id);
  };

  const removeAccess = async (access: MemberAccess) => {
    const { error } = await supabase.from("member_access").delete().eq("id", access.id);
    if (error) {
      setAssignError(getAppErrorMessage(error, "Unable to remove access."));
      return;
    }
    await onMembersChanged();
    await loadMemberAccess(access.member_id);
  };

  return (
    <section className="panel">
      <h2>Admin: members and access</h2>
      <div className="admin-grid">
        <div className="admin-card">
          <h3>Add person</h3>
          <div className="field-row">
            <input
              value={newMemberName}
              onChange={(event) => setNewMemberName(event.target.value)}
              placeholder="Name (e.g. Alex)"
            />
            <button type="button" onClick={addMember} disabled={memberSaving}>
              {memberSaving ? "Saving..." : "Create person"}
            </button>
          </div>
          {memberError ? <p className="error">{memberError}</p> : null}
        </div>

        <div className="admin-card">
          <h3>Assign user access</h3>
          <label htmlFor="admin-member-select">Person</label>
          <select
            id="admin-member-select"
            value={selectedMemberId}
            onChange={(event) => setSelectedMemberId(event.target.value)}
          >
            <option value="">Select person</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
          <label htmlFor="admin-user-search">User email</label>
          <div className="field-row">
            <input
              id="admin-user-search"
              value={searchEmail}
              onChange={(event) => setSearchEmail(event.target.value)}
              placeholder="Search by email"
            />
            <button type="button" onClick={searchUsers}>
              Search
            </button>
          </div>
          {searchResults.length > 0 ? (
            <select value={selectedUserId} onChange={(event) => setSelectedUserId(event.target.value)}>
              <option value="">Select user</option>
              {searchResults.map((result) => (
                <option key={result.user_id} value={result.user_id}>
                  {result.email}
                </option>
              ))}
            </select>
          ) : null}
          <label htmlFor="admin-access-level">Access level</label>
          <select
            id="admin-access-level"
            value={accessLevel}
            onChange={(event) => setAccessLevel(event.target.value as FoodAccessLevel)}
          >
            <option value="viewer">viewer</option>
            <option value="logger">logger</option>
            <option value="admin">admin</option>
          </select>
          <button type="button" onClick={grantAccess}>
            Grant access
          </button>
          {assignError ? <p className="error">{assignError}</p> : null}
        </div>
      </div>

      <h3>Current assignments</h3>
      {memberAccess.length === 0 ? (
        <p className="empty-state">No assignments for selected person.</p>
      ) : (
        <table className="assignment-table">
          <thead>
            <tr>
              <th>User email</th>
              <th>Access</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {memberAccess.map((access) => (
              <tr key={access.id}>
                <td>{emailMap[access.user_id] ?? access.user_id}</td>
                <td>
                  <select
                    value={access.access_level}
                    onChange={(event) =>
                      changeAccess(access, event.target.value as FoodAccessLevel)
                    }
                  >
                    <option value="viewer">viewer</option>
                    <option value="logger">logger</option>
                    <option value="admin">admin</option>
                  </select>
                </td>
                <td>
                  <button type="button" onClick={() => removeAccess(access)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
};
