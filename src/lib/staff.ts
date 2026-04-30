import { createUserWithEmailAndPassword, signOut } from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { getDb, getSecondaryAuth } from "./firebase";

export type StaffRole = "admin" | "kitchen" | "bar" | "runner";

type CreateStaffMemberInput = {
  restaurantId: string;
  email: string;
  password: string;
  role: StaffRole;
};

export async function createStaffMember({
  restaurantId,
  email,
  password,
  role,
}: CreateStaffMemberInput) {
  const db = getDb();
  const secondaryAuth = getSecondaryAuth();

  try {
    const credential = await createUserWithEmailAndPassword(
      secondaryAuth,
      email.trim(),
      password
    );

    const uid = credential.user.uid;

    await setDoc(doc(db, "restaurants", restaurantId, "staff", uid), {
      uid,
      email: email.trim().toLowerCase(),
      role,
      active: true,
      createdAt: serverTimestamp(),
    });

    await signOut(secondaryAuth);

    return {
      uid,
      email: email.trim().toLowerCase(),
      role,
      active: true,
    };
  } catch (error) {
    await signOut(secondaryAuth).catch(() => null);
    throw error;
  }
}