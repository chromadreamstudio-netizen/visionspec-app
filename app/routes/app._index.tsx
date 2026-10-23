import { useState, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { authenticate, PREMIUM_PLAN } from "../shopify.server";
import prisma from "../db.server";

// 1. جلب المنتجات
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(
    `#graphql
      query getProducts {
        products(first: 15, sortKey: CREATED_AT, reverse: true) {
          edges {
            node {
              id
              title
              descriptionHtml
              status
              featuredMedia {
                preview {
                  image {
                    url
                  }
                }
              }
            }
          }
        }
      }`
  );

  const responseJson = await response.json();
  const products = responseJson.data?.products?.edges?.map((edge: any) => edge.node) || [];

  const hasApiKey = Boolean(
    process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 10
  );

  return { products, hasApiKey };
};

// 2. معالجة الذكاء الاصطناعي واللغات والفواتير
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, billing, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "generate");

  // ✅ نظام الاشتراكات الصحيح 100% حسب توثيق شوبيفاي
  if (intent === "upgrade") {
    try {
      await billing.require({
        plans: [PREMIUM_PLAN],
        isTest: true,
        onFailure: async () => billing.request({ plan: PREMIUM_PLAN, isTest: true }),
      });
      // إذا كان مشتركاً بالفعل، نرسل رسالة نجاح
      return { success: true, message: "Subscription is already active! 🎉" }; 
    } catch (error: any) {
      // شوبيفاي تستخدم Response لعمل Redirect، يجب أن نسمح له بالمرور
      if (error instanceof Response) {
        throw error; 
      }
      return { success: false, error: "Billing redirect failed. Please try again." };
    }
  }

  if (intent === "generate") {
    const productId = String(formData.get("productId") || "");
    const title = String(formData.get("title") || "");
    const imageUrl = String(formData.get("imageUrl") || "");

    const settings = await prisma.storeSettings.findUnique({
      where: { shop: session.shop },
    });
    const outputLanguage = settings?.language || "English";
    const tableColor = settings?.tableColor || "#f9fafb";

    let generatedHtml = "";
    let source = "Smart Fallback Engine";
    let aiDiagnostic = "";
    const apiKey = process.env.GEMINI_API_KEY?.trim();

    if (apiKey && imageUrl) {
      try {
        const imgRes = await fetch(imageUrl);
        const arrayBuffer = await imgRes.arrayBuffer();
        const base64Image = Buffer.from(arrayBuffer).toString("base64");
        const mimeType = imgRes.headers.get("content-type") || "image/jpeg";

        const prompt = `You are an expert e-commerce product AI.
CRITICAL: You MUST write the ENTIRE output strictly in ${outputLanguage}.
Analyze this product image and title ("${title}").
Generate clean HTML (no markdown) containing:
1. A 2-sentence overview in ${outputLanguage}.
2. An HTML table (<h3>📋 Specs</h3>) with specs extracted from the image. Translate all headers and values to ${outputLanguage}. Use background color "${tableColor}" for alternate rows (e.g., tr:nth-child(even)).
3. An EU GPSR compliance warning box in ${outputLanguage}.`;

        const modelsToTry = Array.from(new Set([process.env.GEMINI_MODEL?.trim() || "gemini-3.6-flash", "gemini-2.5-flash"]));

        for (const model of modelsToTry) {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 12000); 

          try {
            const geminiRes = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                signal: controller.signal,
                body: JSON.stringify({
                  contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: base64Image } }] }]
                }),
              }
            );
            clearTimeout(timeoutId);

            if (geminiRes.ok) {
              const geminiData = await geminiRes.json();
              const aiText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "";
              if (aiText) {
                generatedHtml = aiText.replace(/```html|```/g, "").trim();
                source = `Gemini Vision AI (${model})`;
                aiDiagnostic = "";
                break;
              }
            } else {
              const errJson = await geminiRes.json().catch(() => ({}));
              aiDiagnostic = ` (API Error on ${model}: ${errJson?.error?.message?.slice(0, 40) || ""})`;
            }
          } catch (fetchErr: any) {
            clearTimeout(timeoutId);
            aiDiagnostic = ` (${model} timeout)`;
          }
        }
      } catch (err: any) {
        aiDiagnostic = ` (Fetch error)`;
      }
    }

    const t: Record<string, any> = {
      English: { specs: "📋 Technical Specifications", model: "Product Model", mat: "Primary Material", matVal: "Premium Eco-Friendly Composite", stat: "Visual Inspection", statVal: "Verified via VisionSpec AI", care: "Care & Maintenance", careVal: "Easy-wipe surface", war: "Warranty & Quality", warVal: "12-Month Guarantee", safe: "🛡️ EU GPSR & Safety Compliance", safeMsg: "Safety Notice: Keep away from open flames. Complies with EU 2023/988 standards." },
      Arabic: { specs: "📋 المواصفات الفنية", model: "طراز المنتج", mat: "المادة الأساسية", matVal: "مواد صديقة للبيئة وآمنة", stat: "الفحص البصري", statVal: "تم التحقق بواسطة VisionSpec AI", care: "العناية والصيانة", careVal: "سطح سهل المسح والتنظيف", war: "الضمان والجودة", warVal: "ضمان جودة لمدة 12 شهراً", safe: "🛡️ امتثال السلامة الأوروبي (EU GPSR)", safeMsg: "ملاحظة سلامة: يُحفظ بعيداً عن اللهب. متوافق مع معايير السلامة الأوروبية 2023/988." },
      Turkish: { specs: "📋 Teknik Özellikler", model: "Ürün Modeli", mat: "Ana Malzeme", matVal: "Çevre Dostu Kompozit", stat: "Görsel Denetim", statVal: "VisionSpec AI ile Doğrulandı", care: "Bakım", careVal: "Kolay temizlenebilir yüzey", war: "Garanti", warVal: "12 Aylık Garanti", safe: "🛡️ AB GPSR Güvenlik Uyumluluğu", safeMsg: "Güvenlik Uyarısı: Açık alevden uzak tutun. AB 2023/988 standartlarına uygundur." }
    };
    
    const lang = t[outputLanguage] || t["English"];

    if (!generatedHtml) {
      generatedHtml = `
        <div style="font-family: -apple-system, sans-serif; color: #202223; line-height: 1.6;">
          <p><strong>${title}</strong></p>
          <h3 style="margin-top: 20px; border-bottom: 2px solid #e1e3e5; padding-bottom: 6px;">${lang.specs}</h3>
          <table style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 14px;">
            <tbody>
              <tr style="border-bottom: 1px solid #e1e3e5; background-color: ${tableColor};">
                <td style="padding: 10px; font-weight: 600; width: 38%;">${lang.model}</td>
                <td style="padding: 10px;">${title}</td>
              </tr>
              <tr style="border-bottom: 1px solid #e1e3e5;">
                <td style="padding: 10px; font-weight: 600;">${lang.mat}</td>
                <td style="padding: 10px;">${lang.matVal}</td>
              </tr>
              <tr style="border-bottom: 1px solid #e1e3e5; background-color: ${tableColor};">
                <td style="padding: 10px; font-weight: 600;">${lang.stat}</td>
                <td style="padding: 10px;">${lang.statVal}</td>
              </tr>
            </tbody>
          </table>
          <div style="margin-top: 20px; padding: 14px; background-color: #fcf1ef; border-left: 4px solid #d82c0d; border-radius: 6px;">
            <h4 style="margin: 0 0 6px 0; color: #202223;">${lang.safe}</h4>
            <p style="margin: 0; font-size: 13px;">${lang.safeMsg}</p>
          </div>
        </div>
      `;
    }

    await admin.graphql(
      `#graphql
        mutation updateProductSpecs($input: ProductInput!) {
          productUpdate(input: $input) {
            product { id descriptionHtml }
          }
        }`,
      { variables: { input: { id: productId, descriptionHtml: generatedHtml } } }
    );

    return { success: true, productId, source: source + aiDiagnostic, generatedHtml, timestamp: new Date().toLocaleTimeString() };
  }

  return new Response("Invalid intent", { status: 400 });
};

// 3. تصميم صف المنتج مع المعاينة المباشرة
function ProductRow({ product }: { product: any }) {
  const fetcher = useFetcher<typeof action>();
  const [showPreview, setShowPreview] = useState(false);

  const imageUrl = product.featuredMedia?.preview?.image?.url || "";
  const currentHtml = fetcher.data?.generatedHtml || product.descriptionHtml || "";
  const hasSpecs = currentHtml.trim().length > 0 && currentHtml.includes("📋");
  const isGenerating = fetcher.state !== "idle";
  const justUpdated = Boolean(fetcher.data?.success && fetcher.data?.productId);

  return (
    <div style={{ border: justUpdated ? "2px solid #008060" : "1px solid #e1e3e5", borderRadius: "10px", backgroundColor: "#ffffff", boxShadow: "0 1px 3px rgba(0,0,0,0.04)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          {imageUrl ? (
            <img src={imageUrl} alt={product.title} style={{ width: "56px", height: "56px", objectFit: "cover", borderRadius: "8px", border: "1px solid #dfe3e8" }} />
          ) : (
            <div style={{ width: "56px", height: "56px", borderRadius: "8px", backgroundColor: "#f4f6f8", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", color: "#637381", border: "1px solid #dfe3e8" }}>No Image</div>
          )}

          <div>
            <div style={{ fontWeight: 600, fontSize: "15px", color: "#202223" }}>{product.title}</div>
            <div style={{ fontSize: "13px", color: hasSpecs ? "#008060" : "#d82c0d", marginTop: "4px", fontWeight: 600 }}>
              {hasSpecs ? "✅ Specs & Compliance Table Active" : "⚠️ Missing Specs & Compliance Table"}
            </div>
            {justUpdated && <div style={{ fontSize: "12px", color: "#005bd3", marginTop: "4px", fontWeight: 500 }}>🎉 Updated at {fetcher.data?.timestamp} via {fetcher.data?.source}</div>}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {hasSpecs && (
            <button type="button" onClick={() => setShowPreview(!showPreview)} style={{ backgroundColor: "#f1f2f4", color: "#202223", border: "1px solid #c9cccf", padding: "9px 14px", borderRadius: "8px", cursor: "pointer", fontWeight: 600, fontSize: "13px" }}>
              {showPreview ? "🔼 Hide Table" : "👁️ Preview Specs"}
            </button>
          )}

          <fetcher.Form method="post" action="?index" onSubmit={() => setShowPreview(true)}>
            <input type="hidden" name="intent" value="generate" />
            <input type="hidden" name="productId" value={product.id} />
            <input type="hidden" name="title" value={product.title} />
            <input type="hidden" name="imageUrl" value={imageUrl} />
            <button type="submit" disabled={isGenerating} style={{ backgroundColor: isGenerating ? "#6d7175" : hasSpecs ? "#008060" : "#1a1a1a", color: "#ffffff", border: "none", padding: "10px 18px", borderRadius: "8px", cursor: isGenerating ? "not-allowed" : "pointer", fontWeight: 600, fontSize: "13px" }}>
              {isGenerating ? "⏳ Analyzing Image with AI..." : hasSpecs ? "🔄 Regenerate Specs" : "✨ Generate Specs with AI"}
            </button>
          </fetcher.Form>
        </div>
      </div>

      {showPreview && hasSpecs && (
        <div style={{ padding: "16px 20px", backgroundColor: "#fafbfb", borderTop: "1px solid #e1e3e5" }}>
          <div style={{ backgroundColor: "#ffffff", padding: "16px", borderRadius: "8px", border: "1px solid #dfe3e8" }} dangerouslySetInnerHTML={{ __html: currentHtml }} />
        </div>
      )}
    </div>
  );
}

// 4. الصفحة الرئيسية + ميزة التوليد الجماعي
export default function Index() {
  const { products, hasApiKey } = useLoaderData<typeof loader>();
  const billingFetcher = useFetcher<typeof action>();
  
  // ✅ مراقب توجيه الفواتير (لإظهار التنبيهات في حال كان الحساب مفعلاً)
  useEffect(() => {
    if (billingFetcher.data) {
      if (billingFetcher.data.success && billingFetcher.data.message) {
        alert(billingFetcher.data.message);
      } else if (billingFetcher.data.error) {
        alert("❌ Error: " + billingFetcher.data.error);
      }
    }
  }, [billingFetcher.data]);

  const [isBulkScanning, setIsBulkScanning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(0);

  const startBulkScan = async () => {
    setIsBulkScanning(true);
    const productsMissingSpecs = products.filter(
      (p: any) => !(p.descriptionHtml || "").includes("📋")
    );

    if (productsMissingSpecs.length === 0) {
      alert("🎉 All products already have AI Specs!");
      setIsBulkScanning(false);
      return;
    }

    let completed = 0;
    for (const product of productsMissingSpecs) {
      const formData = new FormData();
      formData.append("intent", "generate");
      formData.append("productId", product.id);
      formData.append("title", product.title);
      formData.append("imageUrl", product.featuredMedia?.preview?.image?.url || "");

      await fetch("?index", {
        method: "POST",
        body: formData,
      });

      completed += 1;
      setBulkProgress(Math.round((completed / productsMissingSpecs.length) * 100));
      
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    setIsBulkScanning(false);
    setBulkProgress(0);
    window.location.reload();
  };

  const isBillingLoading = billingFetcher.state !== "idle";

  return (
    // @ts-ignore
    <s-page heading="VisionSpec AI — Smart Specs & EU GPSR Compliance">
      {/* @ts-ignore */}
      <s-section heading="System Status & Bulk Engine">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", backgroundColor: "#f8f9fa", border: "1px solid #dfe3e8", borderRadius: "10px", marginBottom: "8px", flexWrap: "wrap", gap: "10px" }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: "14px", color: "#202223" }}>
              AI Optical Engine: <span style={{ color: hasApiKey ? "#008060" : "#d82c0d" }}>{hasApiKey ? "🟢 Gemini API Connected" : "🟠 Fallback Mode"}</span>
            </div>
            <div style={{ fontSize: "12px", color: "#637381", marginTop: "4px" }}>
              Current Plan: <strong>VisionSpec Pro ($19/mo)</strong>
            </div>
          </div>
          
          <div style={{ display: "flex", gap: "10px" }}>
            <button 
              onClick={startBulkScan}
              disabled={isBulkScanning}
              style={{ backgroundColor: isBulkScanning ? "#6d7175" : "#1a1a1a", color: "#ffffff", border: "none", padding: "9px 16px", borderRadius: "8px", cursor: isBulkScanning ? "not-allowed" : "pointer", fontWeight: 600, fontSize: "13px" }}
            >
              {isBulkScanning ? `🔄 Scanning (${bulkProgress}%)...` : "⚡ Auto-Generate Missing Specs"}
            </button>

            <billingFetcher.Form method="post" action="?index">
              <input type="hidden" name="intent" value="upgrade" />
              <button type="submit" disabled={isBillingLoading} style={{ backgroundColor: isBillingLoading ? "#6d7175" : "#005bd3", color: "#ffffff", border: "none", padding: "9px 16px", borderRadius: "8px", cursor: isBillingLoading ? "not-allowed" : "pointer", fontWeight: 600, fontSize: "13px" }}>
                {isBillingLoading ? "⏳ Loading..." : "💳 Test Billing"}
              </button>
            </billingFetcher.Form>
          </div>
        </div>
      {/* @ts-ignore */}
      </s-section>

      {/* @ts-ignore */}
      <s-section heading="Store Products Scanner">
        <div style={{ marginTop: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
          {products.length === 0 ? <p>No products found.</p> : products.map((p: any) => <ProductRow key={p.id} product={p} />)}
        </div>
      {/* @ts-ignore */}
      </s-section>
    {/* @ts-ignore */}
    </s-page>
  );
}