import { createUserWithEmailAndPassword, signOut } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { getDb, getSecondaryAuth } from "./firebase";
import {
  canCreateStaff,
  getStaffLimitLabel,
  normalizePlan,
  PLAN_LABELS,
} from "./plan";

export type StaffRole = "admin" | "kitchen" | "bar" | "runner" | "cashier";

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

  const restaurantSnap = await getDoc(doc(db, "restaurants", restaurantId));

  if (!restaurantSnap.exists()) {
    throw new Error("Restaurante no encontrado.");
  }

  const restaurantData = restaurantSnap.data();
  const plan = normalizePlan(restaurantData.plan);

  const staffSnap = await getDocs(
    collection(db, "restaurants", restaurantId, "staff")
  );

  const activeStaffCount = staffSnap.docs.filter(
    (staffDoc) => staffDoc.data().active === true
  ).length;

  if (!canCreateStaff(plan, activeStaffCount)) {
    throw new Error(
      `El plan ${PLAN_LABELS[plan]} permite hasta ${getStaffLimitLabel(
        plan
      )} empleados activos.`
    );
  }

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
      restaurantId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
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