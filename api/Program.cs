using System.Net.Http.Headers;

var builder = WebApplication.CreateBuilder(args);
var supabaseUrl = builder.Configuration["Supabase:Url"]?.TrimEnd('/');
var supabaseKey = builder.Configuration["Supabase:PublishableKey"];
if (!Uri.TryCreate(supabaseUrl, UriKind.Absolute, out var uri) || uri.Scheme != "https" || string.IsNullOrWhiteSpace(supabaseKey))
    throw new InvalidOperationException("Set Supabase__Url (HTTPS) and Supabase__PublishableKey. Never use a service-role key.");
builder.Services.AddHttpClient("supabase", client => {
    client.BaseAddress = new Uri(supabaseUrl + "/");
    client.DefaultRequestHeaders.Add("apikey", supabaseKey);
    client.Timeout = TimeSpan.FromSeconds(20);
});
builder.Services.AddCors(options => options.AddDefaultPolicy(policy => {
    var origins = builder.Configuration["AllowedOrigins"]?.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries) ?? [];
    if (origins.Length > 0) policy.WithOrigins(origins).AllowAnyHeader().AllowAnyMethod();
}));
var app = builder.Build();
app.UseCors();
app.Use(async (context, next) => {
    try { await next(context); }
    catch (HttpRequestException) { context.Response.StatusCode = 503; await context.Response.WriteAsJsonAsync(new { error = "Database service unavailable. Try again." }); }
    catch (TaskCanceledException) when (!context.RequestAborted.IsCancellationRequested) { context.Response.StatusCode = 504; await context.Response.WriteAsJsonAsync(new { error = "Database service timed out." }); }
});
// Supabase validates the access token on every request. No service-role credential is used;
// the same user token reaches PostgREST so database RLS remains authoritative.
app.Use(async (context, next) => {
    if (!context.Request.Path.StartsWithSegments("/api")) { await next(context); return; }
    if (!AuthenticationHeaderValue.TryParse(context.Request.Headers.Authorization, out var auth) || auth.Scheme != "Bearer" || string.IsNullOrWhiteSpace(auth.Parameter)) {
        context.Response.StatusCode = 401; return;
    }
    var client = context.RequestServices.GetRequiredService<IHttpClientFactory>().CreateClient("supabase");
    client.DefaultRequestHeaders.Authorization = auth;
    using var response = await client.GetAsync("auth/v1/user", context.RequestAborted);
    if (!response.IsSuccessStatusCode) { context.Response.StatusCode = response.StatusCode == System.Net.HttpStatusCode.Unauthorized || response.StatusCode == System.Net.HttpStatusCode.Forbidden ? 401 : 503; return; }
    context.Items["SupabaseClient"] = client;
    await next(context);
});
app.MapGet("/health", () => Results.Ok(new { status = "ok" }));
app.MapGet("/api/household", (HttpContext ctx) => RelayResult(ctx, "get_household", new { }));
app.MapPost("/api/household", (HttpContext ctx, HouseholdInput input) =>
    string.IsNullOrWhiteSpace(input.Name) || input.Name.Trim().Length > 80 ? Results.BadRequest(new { error = "Household name must be 1–80 characters." }) : RelayResult(ctx, "create_household", new { p_name = input.Name.Trim() }));
app.MapPost("/api/household/join", (HttpContext ctx, JoinInput input) =>
    input.Code?.Trim().Length != 32 ? Results.BadRequest(new { error = "Enter the 32-character invitation code." }) : RelayResult(ctx, "join_household", new { p_code = input.Code.Trim() }));
app.MapGet("/api/entries", (HttpContext ctx, string month) => {
    if (!DateOnly.TryParseExact(month + "-01", "yyyy-MM-dd", out var start) || start.Year < 1900 || start.Year > 9998)
        return Results.BadRequest(new { error = "Month must use YYYY-MM." });
    return RelayResult(ctx, "list_entries", new { p_start = start.ToString("yyyy-MM-dd"), p_end = start.AddMonths(1).ToString("yyyy-MM-dd") });
});
app.MapPost("/api/entries", (HttpContext ctx, EntryInput input) => Save(ctx, null, input));
app.MapPut("/api/entries/{id:guid}", (HttpContext ctx, Guid id, EntryInput input) => Save(ctx, id, input));
app.MapDelete("/api/entries/{id:guid}", (HttpContext ctx, Guid id) => RelayResult(ctx, "delete_entry", new { p_id = id }));
app.Run();

static IResult Save(HttpContext ctx, Guid? id, EntryInput input) {
    if (input.Amount <= 0 || input.Amount > 999999999999 || decimal.Round(input.Amount, 2) != input.Amount ||
        input.Kind is not ("income" or "expense") || !Categories.All.Contains(input.Category ?? "") ||
        (input.Note?.Length ?? 0) > 300 || input.Date.Year < 1900 || input.Date.Year > 9998)
        return Results.BadRequest(new { error = "Check the amount, type, category, date, and note (max 300 characters)." });
    return RelayResult(ctx, "save_entry", new { p_id = id, p_amount = input.Amount, p_kind = input.Kind, p_category = input.Category, p_date = input.Date.ToString("yyyy-MM-dd"), p_note = input.Note?.Trim() ?? "" });
}
static IResult RelayResult(HttpContext ctx, string procedure, object payload) => new RpcResult(ctx, procedure, payload);
record HouseholdInput(string? Name);
record JoinInput(string? Code);
record EntryInput(decimal Amount, string? Kind, string? Category, DateOnly Date, string? Note);
static class Categories { public static readonly string[] All = ["Salary", "Other income", "Food", "Transport", "Housing", "Tax", "Utilities", "Health", "Shopping", "Other"]; }
sealed class RpcResult(HttpContext context, string procedure, object payload) : IResult {
    public async Task ExecuteAsync(HttpContext httpContext) {
        // Keep RPC execution asynchronous while allowing validation handlers to return IResult.
        var client = (HttpClient)context.Items["SupabaseClient"]!;
        using var response = await client.PostAsJsonAsync("rest/v1/rpc/" + procedure, payload, context.RequestAborted);
        if (!response.IsSuccessStatusCode) {
            httpContext.Response.StatusCode = response.StatusCode == System.Net.HttpStatusCode.Unauthorized ? 401 : 400;
            await httpContext.Response.WriteAsJsonAsync(new { error = "The operation could not be completed. Check household membership and entry ownership." });
            return;
        }
        httpContext.Response.ContentType = "application/json";
        await response.Content.CopyToAsync(httpContext.Response.Body, context.RequestAborted);
    }
}
