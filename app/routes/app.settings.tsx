import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useActionData, useSubmit, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// 1. جلب الإعدادات المحفوظة مسبقاً من قاعدة البيانات
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  
  let settings = await prisma.storeSettings.findUnique({
    where: { shop: session.shop },
  });

  // إذا لم يكن هناك إعدادات، أعطِ قيماً افتراضية
  if (!settings) {
    settings = { id: 0, shop: session.shop, language: "English", tableColor: "#f9fafb", createdAt: new Date(), updatedAt: new Date() };
  }

  return { settings };
};

// 2. حفظ الإعدادات الجديدة في قاعدة البيانات
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  
  const language = String(formData.get("language") || "English");
  const tableColor = String(formData.get("tableColor") || "#f9fafb");

  await prisma.storeSettings.upsert({
    where: { shop: session.shop },
    update: { language, tableColor },
    create: { shop: session.shop, language, tableColor },
  });

  return { success: true };
};

// 3. تصميم واجهة صفحة الإعدادات بدون استخدام Polaris
export default function Settings() {
  const { settings } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const nav = useNavigation();

  const [language, setLanguage] = useState(settings.language);
  const [tableColor, setTableColor] = useState(settings.tableColor);

  const isSaving = nav.state === "submitting";

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    submit({ language, tableColor }, { method: "post", action: "?index" });
  };

  return (
    <s-page heading="VisionSpec AI Settings">
      <s-section heading="AI Output Preferences">
        <p style={{ color: "#637381", marginBottom: "20px", fontSize: "14px" }}>
          Configure the language and visual styling for your generated product specifications and compliance tables.
        </p>

        {actionData?.success && (
          <div style={{ backgroundColor: "#e3f1df", border: "1px solid #008060", padding: "12px", borderRadius: "8px", marginBottom: "20px", color: "#008060", fontWeight: 600, fontSize: "14px" }}>
            ✅ Settings saved successfully!
          </div>
        )}

        <div style={{ backgroundColor: "#ffffff", padding: "24px", borderRadius: "10px", border: "1px solid #dfe3e8", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
            
            {/* اختيار اللغة */}
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <label style={{ fontWeight: 600, fontSize: "14px", color: "#202223" }}>Generated Specs Language</label>
              <select 
                value={language} 
                onChange={(e) => setLanguage(e.target.value)}
                style={{ padding: "10px 14px", borderRadius: "8px", border: "1px solid #c9cccf", fontSize: "14px", width: "100%", maxWidth: "400px", backgroundColor: "#f9fafb", cursor: "pointer" }}
              >
                <option value="English">English</option>
                <option value="Arabic">Arabic (العربية)</option>
                <option value="Turkish">Turkish (Türkçe)</option>
              </select>
              <span style={{ fontSize: "12px", color: "#637381" }}>VisionSpec AI will translate the specs and compliance text into this language.</span>
            </div>

            {/* اختيار لون الجدول */}
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <label style={{ fontWeight: 600, fontSize: "14px", color: "#202223" }}>Table Theme / Background Color</label>
              <select 
                value={tableColor} 
                onChange={(e) => setTableColor(e.target.value)}
                style={{ padding: "10px 14px", borderRadius: "8px", border: "1px solid #c9cccf", fontSize: "14px", width: "100%", maxWidth: "400px", backgroundColor: "#f9fafb", cursor: "pointer" }}
              >
                <option value="#f9fafb">Light Gray (Default)</option>
                <option value="#ffffff">Pure White</option>
                <option value="#f0f8ff">Soft Blue</option>
                <option value="#f0fff4">Mint Green</option>
                <option value="#fff5f5">Light Rose</option>
              </select>
              <span style={{ fontSize: "12px", color: "#637381" }}>Choose a background color for the alternate rows in the generated table.</span>
            </div>

            {/* زر الحفظ */}
            <div style={{ marginTop: "10px" }}>
              <button 
                type="submit" 
                disabled={isSaving}
                style={{
                  backgroundColor: isSaving ? "#6d7175" : "#1a1a1a",
                  color: "#ffffff",
                  border: "none",
                  padding: "10px 24px",
                  borderRadius: "8px",
                  cursor: isSaving ? "not-allowed" : "pointer",
                  fontWeight: 600,
                  fontSize: "14px",
                  transition: "background-color 0.2s"
                }}
              >
                {isSaving ? "⏳ Saving..." : "💾 Save Settings"}
              </button>
            </div>

          </form>
        </div>
      </s-section>
    </s-page>
  );
}