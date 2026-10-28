import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:file_picker/file_picker.dart';
import 'package:http_parser/http_parser.dart';
import 'package:pdfx/pdfx.dart';
import 'package:http/http.dart' as http;

enum LaxaMode { learner, staff }

class LaxaApp extends StatelessWidget {
  const LaxaApp({super.key, required this.mode});
  final LaxaMode mode;
  @override
  Widget build(BuildContext context) => MaterialApp(
      title: 'Laxalab',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
          useMaterial3: true,
          colorScheme: ColorScheme.fromSeed(
              seedColor: const Color(0xff142641),
              secondary: const Color(0xffc7a45d)),
          scaffoldBackgroundColor: const Color(0xfff5f6f8)),
      home: AuthScreen(mode: mode));
}

class LaxaApi {
  static const baseUrl = String.fromEnvironment('API_BASE_URL',
      defaultValue: 'http://10.0.2.2:3001');
  static const secure = FlutterSecureStorage();
  static Map<String, String> headers(String? token) => {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        if (token != null && token.isNotEmpty)
          'Authorization': 'Bearer ' + token
      };
  static Map<String, dynamic> decode(http.Response r) {
    if (r.body.isEmpty) return {};
    final v = jsonDecode(r.body);
    return v is Map<String, dynamic> ? v : {'data': v};
  }

  static String error(http.Response r) {
    try {
      final d = jsonDecode(r.body);
      return d['message']?.toString() ?? 'خطأ HTTP ' + r.statusCode.toString();
    } catch (_) {
      return 'خطأ HTTP ' + r.statusCode.toString();
    }
  }

  static Future<void> store(Map<String, dynamic> d) async {
    final a = d['access_token'] ?? d['accessToken'];
    final r = d['refresh_token'] ?? d['refreshToken'];
    if (a != null) await secure.write(key: 'accessToken', value: a.toString());
    if (r != null) await secure.write(key: 'refreshToken', value: r.toString());
  }

  static Future<Map<String, dynamic>> post(
      String path, Map<String, dynamic> body) async {
    final r = await http
        .post(Uri.parse(baseUrl + path),
            headers: headers(null), body: jsonEncode(body))
        .timeout(const Duration(seconds: 20));
    if (r.statusCode >= 400) throw Exception(error(r));
    return decode(r);
  }

  static Future<Map<String, dynamic>> get(String path) async {
    final token = await secure.read(key: 'accessToken');
    var r = await http
        .get(Uri.parse(baseUrl + path), headers: headers(token))
        .timeout(const Duration(seconds: 20));
    if (r.statusCode == 401) {
      final refresh = await secure.read(key: 'refreshToken');
      if (refresh != null) {
        final rr = await http
            .post(Uri.parse(baseUrl + '/auth/refresh'),
                headers: headers(null),
                body: jsonEncode({'refreshToken': refresh}))
            .timeout(const Duration(seconds: 20));
        if (rr.statusCode < 300) {
          final d = decode(rr);
          await store(d);
          r = await http
              .get(Uri.parse(baseUrl + path),
                  headers: headers(
                      (d['access_token'] ?? d['accessToken'])?.toString()))
              .timeout(const Duration(seconds: 20));
        }
      }
    }
    if (r.statusCode >= 400) throw Exception(error(r));
    return decode(r);
  }

  static Future<Uint8List> getBytes(String path) async {
    final token = await secure.read(key: 'accessToken');
    var response = await http
        .get(Uri.parse(baseUrl + path), headers: headers(token))
        .timeout(const Duration(seconds: 30));
    if (response.statusCode == 401) {
      final refresh = await secure.read(key: 'refreshToken');
      if (refresh != null) {
        final rr = await http
            .post(Uri.parse(baseUrl + '/auth/refresh'),
                headers: headers(null),
                body: jsonEncode({'refreshToken': refresh}))
            .timeout(const Duration(seconds: 20));
        if (rr.statusCode < 300) {
          final data = decode(rr);
          await store(data);
          response = await http
              .get(Uri.parse(baseUrl + path),
                  headers: headers((data['access_token'] ?? data['accessToken'])
                      ?.toString()))
              .timeout(const Duration(seconds: 30));
        }
      }
    }
    if (response.statusCode >= 400) throw Exception(error(response));
    return response.bodyBytes;
  }

  static Future<String?> _refreshAccess() async {
    final refresh = await secure.read(key: 'refreshToken');
    if (refresh == null || refresh.isEmpty) return null;
    final response = await http
        .post(Uri.parse(baseUrl + '/auth/refresh'),
            headers: headers(null), body: jsonEncode({'refreshToken': refresh}))
        .timeout(const Duration(seconds: 20));
    if (response.statusCode >= 300) return null;
    final data = decode(response);
    await store(data);
    return (data['access_token'] ?? data['accessToken'])?.toString();
  }

  static Future<Map<String, dynamic>> mutate(String method, String path,
      {Map<String, dynamic>? body, String? stepUpCode}) async {
    Future<http.Response> send(String? token) async {
      final h = headers(token);
      if (stepUpCode != null) h['X-Step-Up-Code'] = stepUpCode;
      final request = http.Request(method, Uri.parse(baseUrl + path))
        ..headers.addAll(h);
      if (body != null) request.body = jsonEncode(body);
      final streamed =
          await request.send().timeout(const Duration(seconds: 20));
      return http.Response.fromStream(streamed);
    }

    var response = await send(await secure.read(key: 'accessToken'));
    if (response.statusCode == 401) {
      final refreshed = await _refreshAccess();
      if (refreshed != null) response = await send(refreshed);
    }
    if (response.statusCode >= 400) throw Exception(error(response));
    return decode(response);
  }

  static Future<Map<String, dynamic>> uploadEnrollment({
    required String openingId,
    required PlatformFile receipt,
    String? couponCode,
  }) async {
    final bytes = receipt.bytes;
    if (bytes == null) throw Exception('تعذر قراءة ملف الإيصال');
    final ext = receipt.extension?.toLowerCase();
    final media = ext == 'pdf'
        ? MediaType('application', 'pdf')
        : ext == 'png'
            ? MediaType('image', 'png')
            : MediaType('image', 'jpeg');
    Future<http.Response> send(String? access) async {
      final request =
          http.MultipartRequest('POST', Uri.parse(baseUrl + '/enrollments'));
      request.headers.addAll({
        'Accept': 'application/json',
        if (access != null) 'Authorization': 'Bearer ' + access
      });
      request.fields['openingId'] = openingId;
      if (couponCode != null && couponCode.trim().isNotEmpty) {
        request.fields['couponCode'] = couponCode.trim();
      }
      request.files.add(http.MultipartFile.fromBytes('receipt', bytes,
          filename: receipt.name, contentType: media));
      final streamed =
          await request.send().timeout(const Duration(seconds: 45));
      return http.Response.fromStream(streamed);
    }

    var response = await send(await secure.read(key: 'accessToken'));
    if (response.statusCode == 401) {
      final refreshed = await _refreshAccess();
      if (refreshed != null) response = await send(refreshed);
    }
    if (response.statusCode >= 400) throw Exception(error(response));
    return decode(response);
  }

  static Future<Map<String, dynamic>> uploadTaskFile(
      String taskId, PlatformFile file) async {
    if (file.size > 50 * 1024 * 1024) {
      throw Exception('حجم الملف يتجاوز الحد المسموح (50 ميجابايت)');
    }
    final bytes = file.bytes;
    if (bytes == null) throw Exception('تعذر قراءة الملف');
    Future<http.Response> send(String? access) async {
      final request = http.MultipartRequest(
          'POST', Uri.parse(baseUrl + '/tasks/' + taskId + '/submit-file'));
      request.headers.addAll({
        'Accept': 'application/json',
        if (access != null) 'Authorization': 'Bearer ' + access
      });
      request.files.add(
          http.MultipartFile.fromBytes('file', bytes, filename: file.name));
      final streamed =
          await request.send().timeout(const Duration(seconds: 90));
      return http.Response.fromStream(streamed);
    }

    var response = await send(await secure.read(key: 'accessToken'));
    if (response.statusCode == 401) {
      final refreshed = await _refreshAccess();
      if (refreshed != null) response = await send(refreshed);
    }
    if (response.statusCode >= 400) throw Exception(error(response));
    return decode(response);
  }

  static Future<void> logout() async {
    final access = await secure.read(key: 'accessToken');
    final refresh = await secure.read(key: 'refreshToken');
    try {
      if (access != null)
        await http
            .post(Uri.parse(baseUrl + '/auth/logout'),
                headers: headers(access),
                body: jsonEncode({'refreshToken': refresh}))
            .timeout(const Duration(seconds: 8));
    } catch (_) {}
    await secure.deleteAll();
  }
}

class AuthScreen extends StatefulWidget {
  const AuthScreen({super.key, required this.mode});
  final LaxaMode mode;
  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> {
  bool loading = true;
  Map<String, dynamic>? profile;
  @override
  void initState() {
    super.initState();
    restore();
  }

  bool allowed(Map<String, dynamic> p) {
    final r = p['role']?.toString().toUpperCase();
    return modeSet().contains(r);
  }

  Set<String> modeSet() => widget.mode == LaxaMode.learner
      ? {'STUDENT', 'INSTRUCTOR'}
      : {'COURSE_MANAGER', 'FINANCE', 'ADMIN'};
  Future<void> restore() async {
    try {
      if (await LaxaApi.secure.read(key: 'accessToken') != null) {
        profile = await LaxaApi.get('/users/me');
        if (!allowed(profile!)) {
          await LaxaApi.secure.deleteAll();
          profile = null;
        }
      }
    } catch (_) {
      await LaxaApi.secure.deleteAll();
      profile = null;
    }
    if (mounted) setState(() => loading = false);
  }

  @override
  Widget build(BuildContext context) {
    if (loading)
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    if (profile != null)
      return MainShell(
          mode: widget.mode,
          profile: profile!,
          onLogout: () async {
            await LaxaApi.logout();
            if (mounted) setState(() => profile = null);
          });
    return LoginScreen(
        mode: widget.mode,
        onSuccess: (p) {
          if (allowed(p)) {
            setState(() => profile = p);
          } else {
            LaxaApi.secure.deleteAll();
            ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
                content: Text('الحساب لا يملك صلاحية لهذا التطبيق')));
          }
        });
  }
}

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, required this.mode, required this.onSuccess});
  final LaxaMode mode;
  final ValueChanged<Map<String, dynamic>> onSuccess;
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final email = TextEditingController(),
      password = TextEditingController(),
      code = TextEditingController(),
      newPassword = TextEditingController();
  bool busy = false,
      needsCode = false,
      needsPasswordChange = false,
      needsSetup = false;
  String? temp, secret, error;
  Future<void> submit() async {
    setState(() => {busy = true, error = null});
    try {
      if (needsPasswordChange) {
        await LaxaApi.post('/auth/change-password',
            {'tempToken': temp, 'newPassword': newPassword.text});
        setState(() => {
              needsPasswordChange = false,
              temp = null,
              password.clear(),
              newPassword.clear(),
              code.clear()
            });
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text('تم تحديث كلمة المرور. سجل الدخول بها الآن.')));
        return;
      }
      if (needsSetup) {
        final d = await LaxaApi.post(
            '/auth/2fa/confirm', {'tempToken': temp, 'code': code.text.trim()});
        await LaxaApi.store(d);
        widget.onSuccess(await LaxaApi.get('/users/me'));
        return;
      }
      Map<String, dynamic> d;
      if (!needsCode) {
        final r = await http
            .post(Uri.parse(LaxaApi.baseUrl + '/auth/login'),
                headers: {'Content-Type': 'application/json'},
                body: jsonEncode(
                    {'email': email.text.trim(), 'password': password.text}))
            .timeout(const Duration(seconds: 20));
        if (r.statusCode >= 400) throw Exception(LaxaApi.error(r));
        d = LaxaApi.decode(r);
        temp = d['tempToken']?.toString();
        if (d['requiresPasswordChange'] == true) {
          setState(() => needsPasswordChange = true);
          return;
        }
        if (d['requiresTwoFactorSetup'] == true) {
          final setup =
              await LaxaApi.post('/auth/2fa/setup', {'tempToken': temp});
          secret = setup['secret']?.toString();
          setState(() => needsSetup = true);
          return;
        }
        if (d['requiresTwoFactor'] == true) {
          setState(() => needsCode = true);
          return;
        }
      } else {
        d = await LaxaApi.post('/auth/2fa/verify-login',
            {'tempToken': temp, 'code': code.text.trim()});
      }
      await LaxaApi.store(d);
      widget.onSuccess(await LaxaApi.get('/users/me'));
    } catch (e) {
      setState(() => error = e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final heading = needsPasswordChange
        ? 'تحديث كلمة المرور'
        : needsSetup
            ? 'إعداد التحقق الثنائي'
            : needsCode
                ? 'تأكيد تسجيل الدخول'
                : widget.mode == LaxaMode.learner
                    ? 'لاكسا لاب | الطالب والمدرس'
                    : 'لاكسا لاب | الإدارة';
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        body: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 440),
            child: Card(
              margin: const EdgeInsets.all(24),
              child: Padding(
                padding: const EdgeInsets.all(26),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Icon(Icons.school,
                        size: 50, color: Color(0xffc7a45d)),
                    const SizedBox(height: 12),
                    Text(heading,
                        textAlign: TextAlign.center,
                        style: Theme.of(context).textTheme.titleLarge),
                    const SizedBox(height: 22),
                    if (needsPasswordChange)
                      TextField(
                          controller: newPassword,
                          obscureText: true,
                          decoration: const InputDecoration(
                              labelText: 'كلمة المرور الجديدة',
                              border: OutlineInputBorder()))
                    else if (needsSetup) ...[
                      const Text(
                          'أضف هذا المفتاح إلى تطبيق مصادقة، ثم أدخل الرمز المكوّن من 6 أرقام.'),
                      const SizedBox(height: 8),
                      SelectableText(secret ?? '', textAlign: TextAlign.center),
                      const SizedBox(height: 12),
                      TextField(
                          controller: code,
                          keyboardType: TextInputType.number,
                          decoration: const InputDecoration(
                              labelText: 'رمز التحقق',
                              border: OutlineInputBorder())),
                    ] else if (needsCode)
                      TextField(
                          controller: code,
                          keyboardType: TextInputType.number,
                          decoration: const InputDecoration(
                              labelText: 'رمز التحقق الثنائي',
                              border: OutlineInputBorder()))
                    else ...[
                      TextField(
                          controller: email,
                          keyboardType: TextInputType.emailAddress,
                          decoration: const InputDecoration(
                              labelText: 'البريد الإلكتروني',
                              border: OutlineInputBorder())),
                      const SizedBox(height: 12),
                      TextField(
                          controller: password,
                          obscureText: true,
                          decoration: const InputDecoration(
                              labelText: 'كلمة المرور',
                              border: OutlineInputBorder())),
                    ],
                    if (error != null)
                      Padding(
                          padding: const EdgeInsets.only(top: 12),
                          child: Text(error!,
                              style: const TextStyle(color: Colors.red))),
                    const SizedBox(height: 18),
                    FilledButton(
                        onPressed: busy ? null : submit,
                        child: Text(busy
                            ? 'جارٍ الإجراء...'
                            : needsPasswordChange
                                ? 'حفظ كلمة المرور'
                                : needsSetup
                                    ? 'تفعيل التحقق الثنائي'
                                    : 'تسجيل الدخول')),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  @override
  void dispose() {
    email.dispose();
    password.dispose();
    code.dispose();
    newPassword.dispose();
    super.dispose();
  }
}

class _Page {
  const _Page(this.label, this.icon, this.path);
  final String label;
  final IconData icon;
  final String? path;
}

class MainShell extends StatefulWidget {
  const MainShell(
      {super.key,
      required this.mode,
      required this.profile,
      required this.onLogout});
  final LaxaMode mode;
  final Map<String, dynamic> profile;
  final VoidCallback onLogout;
  @override
  State<MainShell> createState() => _MainShellState();
}

class _MainShellState extends State<MainShell> {
  int selected = 0;
  List<_Page> get pages {
    if (widget.mode == LaxaMode.learner) {
      final role = widget.profile['role']?.toString().toUpperCase();
      if (role == 'INSTRUCTOR')
        return const [
          _Page('الرئيسية', Icons.home_outlined, null),
          _Page('الفرص المكلف بها', Icons.event_available_outlined,
              '/openings/mine'),
          _Page('المقررات', Icons.menu_book_outlined, '/courses'),
          _Page('الرسائل', Icons.forum_outlined, '/messages/conversations'),
          _Page('حسابي', Icons.person_outline, '/users/me')
        ];
      return const [
        _Page('الرئيسية', Icons.home_outlined, null),
        _Page('دوراتي', Icons.menu_book_outlined, '/enrollments/my'),
        _Page('الكتالوج', Icons.school_outlined, '/courses'),
        _Page('الرسائل', Icons.forum_outlined, '/messages/conversations'),
        _Page('حسابي', Icons.person_outline, '/users/me')
      ];
    }
    final role = widget.profile['role']?.toString().toUpperCase();
    if (role == 'FINANCE')
      return const [
        _Page('الرئيسية', Icons.home_outlined, null),
        _Page('التسجيلات', Icons.receipt_long_outlined, '/enrollments/pending'),
        _Page('المستردات', Icons.currency_exchange, '/refunds?status=PENDING'),
        _Page('التقارير المالية', Icons.analytics_outlined,
            '/api/admin/finance/reports'),
        _Page('حسابي', Icons.person_outline, '/users/me')
      ];
    if (role == 'ADMIN')
      return const [
        _Page('الرئيسية', Icons.home_outlined, null),
        _Page('المستخدمون', Icons.people_outline, '/users'),
        _Page('الدورات', Icons.menu_book_outlined, '/courses'),
        _Page('الإحصاءات', Icons.analytics_outlined,
            '/api/admin/operations/overview'),
        _Page('حسابي', Icons.person_outline, '/users/me')
      ];
    return const [
      _Page('الرئيسية', Icons.home_outlined, null),
      _Page('الفرص', Icons.event_available_outlined, '/openings/mine'),
      _Page('الدورات', Icons.menu_book_outlined, '/courses'),
      _Page('الرسائل', Icons.forum_outlined, '/messages/conversations'),
      _Page('حسابي', Icons.person_outline, '/users/me')
    ];
  }

  List<_Page> get morePages {
    final role = widget.profile['role']?.toString().toUpperCase();
    if (role == 'STUDENT')
      return const [
        _Page('درجاتي', Icons.grade_outlined, '/enrollments/my/grades'),
        _Page('المهام الدراسية', Icons.assignment_outlined, '/tasks'),
        _Page('شهاداتي', Icons.workspace_premium_outlined, '/certificates/my'),
        _Page(
            'أهلية الاسترداد', Icons.currency_exchange, '/refunds/eligibility'),
        _Page('طلبات الاسترداد', Icons.receipt_long_outlined, '/refunds/mine'),
        _Page('المدفوعات', Icons.payments_outlined, '/payments/my'),
        _Page('الإشعارات', Icons.notifications_outlined, '/notifications'),
        _Page('الدعم', Icons.support_agent_outlined, '/support-tickets/my'),
      ];
    if (role == 'INSTRUCTOR')
      return const [
        _Page('تسليمات الطلاب', Icons.assignment_turned_in_outlined,
            '/tasks/submissions'),
        _Page('الإشعارات', Icons.notifications_outlined, '/notifications'),
        _Page('الدعم', Icons.support_agent_outlined, '/support-tickets/my'),
      ];
    if (role == 'FINANCE')
      return const [
        _Page('سجل التسجيلات', Icons.history, '/enrollments/all'),
        _Page('القسائم', Icons.discount_outlined, '/api/admin/finance/coupons'),
        _Page('الإشعارات', Icons.notifications_outlined, '/notifications'),
      ];
    if (role == 'COURSE_MANAGER')
      return const [
        _Page('تسليمات الطلاب', Icons.assignment_turned_in_outlined,
            '/tasks/submissions'),
        _Page('ملخص العمليات', Icons.analytics_outlined,
            '/api/admin/operations/overview'),
        _Page('الإشعارات', Icons.notifications_outlined, '/notifications'),
        _Page('الدعم', Icons.support_agent_outlined,
            '/api/admin/support-tickets'),
      ];
    return const [
      _Page('تسليمات الطلاب', Icons.assignment_turned_in_outlined,
          '/tasks/submissions'),
      _Page('سجل العمليات', Icons.history, '/api/admin/operations/timeline'),
      _Page(
          'الأحداث', Icons.event_note_outlined, '/api/admin/operations/events'),
      _Page('القسائم', Icons.discount_outlined, '/api/admin/finance/coupons'),
      _Page(
          'الدعم', Icons.support_agent_outlined, '/api/admin/support-tickets'),
    ];
  }

  Future<void> _showMore(BuildContext context) async {
    final choices = morePages;
    final selectedPage = await showModalBottomSheet<_Page>(
        context: context,
        builder: (context) => SafeArea(
                child: ListView(shrinkWrap: true, children: [
              const ListTile(title: Text('مساحات إضافية')),
              for (final page in choices)
                ListTile(
                    leading: Icon(page.icon),
                    title: Text(page.label),
                    onTap: () => Navigator.pop(context, page)),
            ])));
    if (selectedPage == null || !mounted) return;
    if (selectedPage.path == '/tasks') {
      await Navigator.of(context)
          .push(MaterialPageRoute(builder: (_) => const _StudentTasksPage()));
      return;
    }
    await Navigator.of(context).push(MaterialPageRoute(
        builder: (_) => Scaffold(
              appBar: AppBar(
                  title: Text(selectedPage.label),
                  actions: selectedPage.path == '/notifications'
                      ? [
                          IconButton(
                              tooltip: 'تعليم الكل كمقروء',
                              icon: const Icon(Icons.done_all),
                              onPressed: () async {
                                try {
                                  await LaxaApi.mutate(
                                      'PATCH', '/notifications/read-all');
                                  if (context.mounted) {
                                    ScaffoldMessenger.of(context).showSnackBar(
                                        const SnackBar(
                                            content: Text(
                                                'تم تعليم الإشعارات كمقروءة')));
                                  }
                                } catch (e) {
                                  if (context.mounted) {
                                    ScaffoldMessenger.of(context).showSnackBar(
                                        SnackBar(content: Text(e.toString())));
                                  }
                                }
                              })
                        ]
                      : []),
              body: _RemotePage(
                  path: selectedPage.path!, profile: widget.profile),
            )));
  }

  @override
  Widget build(BuildContext context) {
    final nav = pages;
    return Directionality(
        textDirection: TextDirection.rtl,
        child: LayoutBuilder(builder: (context, size) {
          final wide = size.maxWidth >= 760;
          return Scaffold(
              appBar: AppBar(title: Text(nav[selected].label), actions: [
                IconButton(
                    tooltip: 'مساحات إضافية',
                    onPressed: () => _showMore(context),
                    icon: const Icon(Icons.more_horiz)),
                IconButton(
                    tooltip: 'تسجيل الخروج',
                    onPressed: widget.onLogout,
                    icon: const Icon(Icons.logout))
              ]),
              body: Row(children: [
                if (wide)
                  NavigationRail(
                      selectedIndex: selected,
                      onDestinationSelected: (i) =>
                          setState(() => selected = i),
                      labelType: NavigationRailLabelType.all,
                      destinations: [
                        for (final p in nav)
                          NavigationRailDestination(
                              icon: Icon(p.icon), label: Text(p.label))
                      ]),
                Expanded(
                    child: selected == 0
                        ? _Dashboard(
                            profile: widget.profile,
                            pages: nav,
                            onSelect: (i) => setState(() => selected = i))
                        : _RemotePage(
                            path: nav[selected].path ?? '/users/me',
                            profile: widget.profile))
              ]),
              bottomNavigationBar: wide
                  ? null
                  : NavigationBar(
                      selectedIndex: selected,
                      onDestinationSelected: (i) =>
                          setState(() => selected = i),
                      destinations: [
                          for (final p in nav)
                            NavigationDestination(
                                icon: Icon(p.icon), label: p.label)
                        ]));
        }));
  }
}

class _Dashboard extends StatelessWidget {
  const _Dashboard(
      {required this.profile, required this.pages, required this.onSelect});
  final Map<String, dynamic> profile;
  final List<_Page> pages;
  final ValueChanged<int> onSelect;
  @override
  Widget build(BuildContext context) {
    final metadata = profile['metadata'] is Map
        ? Map<String, dynamic>.from(profile['metadata'])
        : <String, dynamic>{};
    final name = profile['fullName']?.toString() ??
        metadata['fullName']?.toString() ??
        metadata['nameAr']?.toString() ??
        profile['email']?.toString() ??
        'مرحباً بك';
    final stats = profile['stats'] is Map
        ? Map<String, dynamic>.from(profile['stats'])
        : <String, dynamic>{};
    const statLabels = {
      'enrollments': 'التسجيلات',
      'certificates': 'الشهادات',
      'coursesTaught': 'المقررات التي تدرسها',
      'openingsTaught': 'الشُعب المكلف بها',
      'pendingEnrollments': 'طلبات تنتظر المراجعة',
      'unreadMessages': 'رسائل غير مقروءة',
      'unreadNotifications': 'إشعارات غير مقروءة',
      'tickets': 'تذاكر الدعم'
    };
    return ListView(padding: const EdgeInsets.all(20), children: [
      Card(
          color: const Color(0xff142641),
          child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('مرحباً، ' + name,
                        style: Theme.of(context)
                            .textTheme
                            .headlineSmall
                            ?.copyWith(color: Colors.white)),
                    const SizedBox(height: 8),
                    Text(profile['role']?.toString() ?? '',
                        style: const TextStyle(color: Colors.white70)),
                    const SizedBox(height: 16),
                    const Text('منصة Laxalab التعليمية',
                        style: TextStyle(color: Color(0xffe3c77f)))
                  ]))),
      if (stats.isNotEmpty) ...[
        const SizedBox(height: 18),
        Text('ملخص حسابك', style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 8),
        GridView.count(
          crossAxisCount: 2,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          childAspectRatio: 2.0,
          children: [
            for (final entry in stats.entries
                .where((entry) => statLabels.containsKey(entry.key)))
              Card(
                  child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(entry.value.toString(),
                          style: Theme.of(context)
                              .textTheme
                              .titleLarge
                              ?.copyWith(
                                  color: const Color(0xff142641),
                                  fontWeight: FontWeight.bold)),
                      Text(statLabels[entry.key]!,
                          textAlign: TextAlign.center,
                          style: Theme.of(context).textTheme.bodySmall),
                    ]),
              )),
          ],
        ),
      ],
      const SizedBox(height: 18),
      Text('الوصول السريع', style: Theme.of(context).textTheme.titleLarge),
      for (var i = 1; i < pages.length; i++)
        Card(
            child: ListTile(
                leading: Icon(pages[i].icon, color: const Color(0xffc7a45d)),
                title: Text(pages[i].label),
                trailing: const Icon(Icons.chevron_left),
                onTap: () => onSelect(i)))
    ]);
  }
}

class _RemotePage extends StatefulWidget {
  const _RemotePage({required this.path, required this.profile});
  final String path;
  final Map<String, dynamic> profile;
  @override
  State<_RemotePage> createState() => _RemotePageState();
}

class _RemotePageState extends State<_RemotePage> {
  late Future<Map<String, dynamic>> future;
  @override
  void initState() {
    super.initState();
    future = LaxaApi.get(widget.path);
  }

  @override
  void didUpdateWidget(covariant _RemotePage old) {
    super.didUpdateWidget(old);
    if (old.path != widget.path) future = LaxaApi.get(widget.path);
  }

  void reload() {
    setState(() => future = LaxaApi.get(widget.path));
  }

  List<dynamic>? _list(Map<String, dynamic> data) {
    for (final key in [
      'data',
      'items',
      'courses',
      'enrollments',
      'conversations',
      'openings',
      'users',
      'refunds'
    ]) {
      if (data[key] is List) return data[key] as List;
    }
    return null;
  }

  String _title(Map<String, dynamic> row) =>
      ((row['studentName'] is Map ? row['studentName']['nameAr'] : null) ??
              (row['task'] is Map ? row['task']['titleAr'] : null) ??
              row['titleAr'] ??
              row['title'] ??
              row['name'] ??
              row['email'] ??
              row['courseName'] ??
              row['id'] ??
              'عنصر')
          .toString();
  String _subtitle(Map<String, dynamic> row) => (row['status'] ??
          row['description'] ??
          row['role'] ??
          row['lastMessage']?['content'] ??
          '')
      .toString();

  Future<void> _open(Map<String, dynamic> row) async {
    if (widget.path == '/messages/conversations') {
      final other = row['otherUser'];
      if (other is Map && other['id'] != null) {
        await Navigator.of(context).push(MaterialPageRoute(
            builder: (_) => _ConversationPage(
                other: Map<String, dynamic>.from(other),
                course: row['course'] is Map
                    ? Map<String, dynamic>.from(row['course'])
                    : null)));
      }
      return;
    }
    if (widget.path == '/enrollments/pending') {
      await _reviewEnrollment(row);
      return;
    }
    if (widget.path.startsWith('/tasks/submissions')) {
      await _gradeSubmission(row);
      return;
    }
    if (widget.path == '/notifications' && row['id'] != null) {
      try {
        await LaxaApi.mutate(
            'PATCH', '/notifications/' + row['id'].toString() + '/read');
        if (mounted) reload();
      } catch (e) {
        if (mounted) _message(e.toString());
      }
      return;
    }
    if (widget.path == '/refunds/eligibility') {
      if (row['eligible'] == true)
        await _requestRefund(row);
      else
        await _details(row);
      return;
    }
    if (widget.path.startsWith('/refunds?')) {
      await _reviewRefund(row);
      return;
    }
    if (widget.path == '/refunds/mine') {
      await _details(row);
      return;
    }
    if (widget.path == '/courses' && row['id'] != null) {
      await Navigator.of(context).push(MaterialPageRoute(
          builder: (_) => Scaffold(
              appBar: AppBar(title: Text(_title(row))),
              body: _RemotePage(
                  path: '/courses/' + row['id'].toString() + '/openings',
                  profile: widget.profile))));
      return;
    }
    if (widget.path.contains('/openings') &&
        widget.profile['role']?.toString().toUpperCase() == 'STUDENT' &&
        row['id'] != null) {
      final courseId = widget.path.startsWith('/courses/')
          ? widget.path.split('/')[2]
          : row['courseId']?.toString();
      if (courseId != null) await _openingChoices(row, courseId);
      return;
    }
    if (widget.path == '/openings/mine' && row['id'] != null) {
      await _openingActions(row);
      return;
    }
    if (widget.path == '/enrollments/my' && row['id'] != null) {
      await _enrollmentDetails(row);
      return;
    }
    await _details(row);
  }

  Future<void> _details(Map<String, dynamic> row) async {
    await showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        builder: (context) => SafeArea(
            child: Padding(
                padding: const EdgeInsets.all(20),
                child: Wrap(spacing: 8, runSpacing: 8, children: [
                  Text(_title(row),
                      style: Theme.of(context).textTheme.titleLarge),
                  for (final entry in row.entries)
                    SizedBox(
                        width: MediaQuery.of(context).size.width - 48,
                        child: Text(entry.key +
                            ': ' +
                            (entry.value is Map || entry.value is List
                                ? jsonEncode(entry.value)
                                : entry.value.toString()))),
                  const SizedBox(height: 24),
                ]))));
  }

  Future<void> _openingChoices(
      Map<String, dynamic> opening, String courseId) async {
    final choice = await showModalBottomSheet<String>(
        context: context,
        builder: (context) => SafeArea(
                child: Column(mainAxisSize: MainAxisSize.min, children: [
              ListTile(
                  title: Text(_title(opening)),
                  subtitle: Text('حالة الشعبة: ' + _subtitle(opening))),
              ListTile(
                  leading: const Icon(Icons.event_seat),
                  title: const Text('حجز مقعد دون دفع'),
                  onTap: () => Navigator.pop(context, 'reserve')),
              ListTile(
                  leading: const Icon(Icons.upload_file),
                  title: const Text('التسجيل مع إرفاق إيصال'),
                  onTap: () => Navigator.pop(context, 'receipt')),
            ])));
    if (choice == 'reserve') {
      if (await _confirm('حجز مقعد', 'هل تريد إرسال طلب حجز لهذا المقرر؟') !=
          true) return;
      try {
        await LaxaApi.mutate('POST', '/enrollments/reserve',
            body: {'courseId': courseId});
        if (mounted) {
          _message('تم إرسال طلب الحجز');
          reload();
        }
      } catch (e) {
        if (mounted) _message(e.toString());
      }
    } else if (choice == 'receipt') {
      final details = await showDialog<_ReceiptEnrollmentData>(
          context: context, builder: (_) => const _ReceiptEnrollmentDialog());
      if (details == null) return;
      try {
        await LaxaApi.uploadEnrollment(
            openingId: opening['id'].toString(),
            receipt: details.file,
            couponCode: details.coupon);
        if (mounted) {
          _message('تم إرسال طلب التسجيل والإيصال للمراجعة');
          reload();
        }
      } catch (e) {
        if (mounted) _message(e.toString());
      }
    }
  }

  Future<void> _gradeSubmission(Map<String, dynamic> row) async {
    final id = row['id']?.toString();
    if (id == null) return;
    final task = row['task'] is Map
        ? Map<String, dynamic>.from(row['task'])
        : <String, dynamic>{};
    final maxScore = (task['maxScore'] as num?)?.toDouble() ?? 100;
    final score = TextEditingController(text: row['score']?.toString() ?? '');
    final notes = TextEditingController(text: row['notes']?.toString() ?? '');
    final result = await showDialog<Map<String, dynamic>>(
        context: context,
        builder: (context) => AlertDialog(
              title: const Text('تقييم تسليم الطالب'),
              content: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text((task['titleAr'] ?? 'المهمة').toString()),
                    Text('الدرجة القصوى: ' + maxScore.toString()),
                    TextField(
                        controller: score,
                        keyboardType: const TextInputType.numberWithOptions(
                            decimal: true),
                        decoration: const InputDecoration(labelText: 'الدرجة')),
                    TextField(
                        controller: notes,
                        maxLines: 3,
                        decoration:
                            const InputDecoration(labelText: 'ملاحظات')),
                  ]),
              actions: [
                TextButton(
                    onPressed: () => Navigator.pop(context),
                    child: const Text('إلغاء')),
                FilledButton(
                    onPressed: () {
                      final value = double.tryParse(score.text.trim());
                      if (value == null || value < 0 || value > maxScore) {
                        ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                                content:
                                    Text('أدخل درجة بين صفر والدرجة القصوى')));
                        return;
                      }
                      Navigator.pop(context,
                          {'score': value, 'notes': notes.text.trim()});
                    },
                    child: const Text('حفظ التقييم')),
              ],
            ));
    score.dispose();
    notes.dispose();
    if (result == null) return;
    try {
      await LaxaApi.mutate('PATCH', '/tasks/submissions/' + id + '/grade',
          body: result);
      if (mounted) {
        _message('تم حفظ التقييم');
        reload();
      }
    } catch (e) {
      if (mounted) _message(e.toString());
    }
  }

  Future<void> _reviewEnrollment(Map<String, dynamic> row) async {
    final id = row['id']?.toString();
    if (id == null) return;
    if (row['receiptFileUrl'] != null ||
        row['receiptUrl'] != null ||
        row['receipt'] != null) {
      final preview = await showDialog<bool>(
          context: context,
          builder: (c) => AlertDialog(
                title: const Text('إيصال التسجيل'),
                content: const Text('هل تريد معاينة الإيصال قبل اتخاذ القرار؟'),
                actions: [
                  TextButton(
                      onPressed: () => Navigator.pop(c, false),
                      child: const Text('متابعة')),
                  FilledButton(
                      onPressed: () => Navigator.pop(c, true),
                      child: const Text('عرض الإيصال')),
                ],
              ));
      if (preview == true && mounted) {
        await _showReceipt(id, _title(row));
        if (!mounted) return;
        await _reviewEnrollment(row);
        return;
      }
    }
    final decision = await showDialog<String>(
        context: context,
        builder: (c) => AlertDialog(
                title: const Text('مراجعة طلب التسجيل'),
                content: Text(_title(row) + '\nالحالة: ' + _subtitle(row)),
                actions: [
                  TextButton(
                      onPressed: () => Navigator.pop(c, 'REJECTED'),
                      child: const Text('رفض')),
                  FilledButton(
                      onPressed: () => Navigator.pop(c, 'APPROVED'),
                      child: const Text('اعتماد')),
                ]));
    if (decision == null) return;
    try {
      await LaxaApi.mutate('PATCH', '/enrollments/' + id + '/review',
          body: {'status': decision});
      if (mounted) {
        _message(
            decision == 'APPROVED' ? 'تم اعتماد التسجيل' : 'تم رفض التسجيل');
        reload();
      }
    } catch (e) {
      if (mounted) _message(e.toString());
    }
  }

  Future<void> _requestRefund(Map<String, dynamic> row) async {
    final courseId = row['courseId']?.toString();
    if (courseId == null) return;
    final result = await showDialog<_RefundFormData>(
        context: context, builder: (_) => const _RefundRequestDialog());
    if (result == null) return;
    try {
      await LaxaApi.mutate('POST', '/refunds', body: {
        'courseId': courseId,
        'method': result.method,
        'accountName': result.accountName,
        'accountNumber': result.accountNumber,
        'studentNote': result.note,
      });
      if (mounted) {
        _message('تم إرسال طلب الاسترداد');
        reload();
      }
    } catch (e) {
      if (mounted) _message(e.toString());
    }
  }

  Future<void> _reviewRefund(Map<String, dynamic> row) async {
    final id = row['id']?.toString();
    if (id == null) return;
    final decision = await showDialog<String>(
        context: context,
        builder: (c) => AlertDialog(
                title: const Text('مراجعة طلب الاسترداد'),
                content: Text(_title(row) + '\nتتطلب العملية رمز تحقق حديثاً.'),
                actions: [
                  TextButton(
                      onPressed: () => Navigator.pop(c, 'REJECTED'),
                      child: const Text('رفض')),
                  FilledButton(
                      onPressed: () => Navigator.pop(c, 'APPROVED'),
                      child: const Text('اعتماد')),
                ]));
    if (decision == null) return;
    final code = TextEditingController();
    final entered = await showDialog<String>(
        context: context,
        builder: (c) => AlertDialog(
                title: const Text('تأكيد مالي'),
                content: TextField(
                    controller: code,
                    keyboardType: TextInputType.number,
                    maxLength: 6,
                    decoration: const InputDecoration(
                        labelText: 'رمز المصادقة المكون من 6 أرقام')),
                actions: [
                  TextButton(
                      onPressed: () => Navigator.pop(c),
                      child: const Text('إلغاء')),
                  FilledButton(
                      onPressed: () => Navigator.pop(c, code.text.trim()),
                      child: const Text('متابعة'))
                ]));
    code.dispose();
    if (entered == null || entered.length != 6) return;
    try {
      await LaxaApi.mutate('PATCH', '/refunds/' + id,
          body: {'status': decision}, stepUpCode: entered);
      if (mounted) {
        _message('تم تحديث طلب الاسترداد');
        reload();
      }
    } catch (e) {
      if (mounted) _message(e.toString());
    }
  }

  Future<void> _openingActions(Map<String, dynamic> row) async {
    final id = row['id']?.toString();
    if (id == null) return;
    final role = widget.profile['role']?.toString().toUpperCase();
    final actions = <String, String>{
      'عرض قائمة المتدربين': '/openings/' + id + '/roster',
      'إدارة مكونات التقييم': '/openings/' + id + '/assessments',
      'عرض المهام': '/tasks/opening/' + id
    };
    if (role == 'ADMIN' || role == 'COURSE_MANAGER') {
      final status = row['status']?.toString().toUpperCase();
      if (status == 'DRAFT')
        actions['نشر الإعلان'] = '/openings/' + id + '/publish';
      if (status == 'ANNOUNCEMENT')
        actions['فتح التسجيل'] = '/openings/' + id + '/open';
      if (status == 'OPEN')
        actions['بدء الدورة'] = '/openings/' + id + '/start';
      if (status == 'STARTED')
        actions['إنهاء الدورة'] = '/openings/' + id + '/end';
    }
    final route = await showModalBottomSheet<String>(
        context: context,
        builder: (c) => SafeArea(
                child: Column(mainAxisSize: MainAxisSize.min, children: [
              ListTile(
                  title: Text(_title(row)),
                  subtitle: Text('الحالة: ' + _subtitle(row))),
              for (final a in actions.entries)
                ListTile(
                    title: Text(a.key), onTap: () => Navigator.pop(c, a.value)),
            ])));
    if (route == null) return;
    if (route.startsWith('/openings/') && route.endsWith('/assessments')) {
      await Navigator.of(context).push(MaterialPageRoute(
          builder: (_) =>
              _AssessmentsPage(openingId: id, profile: widget.profile)));
      return;
    }
    if (route.startsWith('/openings/') &&
        (route.endsWith('/roster') || route.endsWith('/start'))) {
      if (route.endsWith('/roster')) {
        await Navigator.of(context).push(MaterialPageRoute(
            builder: (_) => _InstructorRosterPage(openingId: id)));
        return;
      }
    }
    if (route.startsWith('/tasks/opening/')) {
      await Navigator.of(context).push(MaterialPageRoute(
          builder: (_) => _InstructorTasksPage(openingId: id)));
      return;
    }
    if (route.startsWith('/tasks/')) {
      await Navigator.of(context).push(MaterialPageRoute(
          builder: (_) => Scaffold(
              appBar: AppBar(title: const Text('المهام')),
              body: _RemotePage(path: route, profile: widget.profile))));
      return;
    }
    final ok = await _confirm('تأكيد الإجراء',
        actions.entries.firstWhere((e) => e.value == route).key + '؟');
    if (ok != true) return;
    try {
      await LaxaApi.mutate('POST', route);
      if (mounted) {
        _message('تم تحديث حالة الدورة');
        reload();
      }
    } catch (e) {
      if (mounted) _message(e.toString());
    }
  }

  Future<void> _showReceipt(String enrollmentId, String title) async {
    await Navigator.of(context).push(MaterialPageRoute(
        builder: (_) =>
            _ReceiptPreviewPage(enrollmentId: enrollmentId, title: title)));
  }

  Future<void> _enrollmentDetails(Map<String, dynamic> row) async {
    final id = row['id']?.toString();
    if (id == null) return;
    final action = await showModalBottomSheet<String>(
        context: context,
        builder: (c) => SafeArea(
                child: Column(mainAxisSize: MainAxisSize.min, children: [
              ListTile(
                  title: Text(_title(row)),
                  subtitle: Text('الحالة: ' + _subtitle(row))),
              ListTile(
                  leading: const Icon(Icons.receipt_long),
                  title: const Text('عرض تفاصيل التسجيل'),
                  onTap: () => Navigator.pop(c, 'details')),
              if (row['receiptFileUrl'] != null ||
                  row['receiptUrl'] != null ||
                  row['receipt'] != null)
                ListTile(
                    leading: const Icon(Icons.visibility_outlined),
                    title: const Text('عرض الإيصال'),
                    onTap: () => Navigator.pop(c, 'receipt')),
              if (row['status'] == 'PENDING' || row['status'] == 'RESERVED')
                ListTile(
                    leading: const Icon(Icons.cancel_outlined),
                    title: const Text('سحب الطلب'),
                    onTap: () => Navigator.pop(c, 'withdraw')),
            ])));
    if (action == 'details') {
      await _details(row);
      return;
    }
    if (action == 'receipt') {
      await _showReceipt(id, _title(row));
      return;
    }
    if (action == 'withdraw' &&
        await _confirm('سحب التسجيل', 'هل تريد سحب طلبك؟') == true) {
      try {
        await LaxaApi.mutate('DELETE', '/enrollments/' + id);
        if (mounted) {
          _message('تم سحب الطلب');
          reload();
        }
      } catch (e) {
        if (mounted) _message(e.toString());
      }
    }
  }

  Future<bool?> _confirm(String title, String body) => showDialog<bool>(
      context: context,
      builder: (c) =>
          AlertDialog(title: Text(title), content: Text(body), actions: [
            TextButton(
                onPressed: () => Navigator.pop(c, false),
                child: const Text('إلغاء')),
            FilledButton(
                onPressed: () => Navigator.pop(c, true),
                child: const Text('تأكيد'))
          ]));
  void _message(String message) => ScaffoldMessenger.of(context)
      .showSnackBar(SnackBar(content: Text(message)));

  @override
  Widget build(BuildContext context) => FutureBuilder<Map<String, dynamic>>(
      future: future,
      builder: (context, s) {
        if (s.connectionState != ConnectionState.done)
          return const Center(child: CircularProgressIndicator());
        if (s.hasError)
          return Center(
              child: Column(mainAxisSize: MainAxisSize.min, children: [
            Padding(
                padding: const EdgeInsets.all(24),
                child: Text(
                    s.error.toString() + '\nتحقق من الشبكة وصلاحية الحساب.',
                    textAlign: TextAlign.center)),
            FilledButton.icon(
                onPressed: reload,
                icon: const Icon(Icons.refresh),
                label: const Text('إعادة المحاولة'))
          ]));
        final data = s.data ?? {};
        final rows = _list(data);
        if (rows != null) {
          if (rows.isEmpty)
            return const Center(child: Text('لا توجد عناصر لعرضها حالياً'));
          return RefreshIndicator(
              onRefresh: () async => reload(),
              child: ListView.builder(
                  itemCount: rows.length,
                  itemBuilder: (context, index) {
                    final value = rows[index];
                    if (value is! Map)
                      return ListTile(title: Text(value.toString()));
                    final row = Map<String, dynamic>.from(value);
                    return Card(
                        margin: const EdgeInsets.symmetric(
                            horizontal: 14, vertical: 6),
                        child: ListTile(
                            leading: Icon(
                                widget.path == '/messages/conversations'
                                    ? Icons.forum_outlined
                                    : Icons.article_outlined,
                                color: const Color(0xffc7a45d)),
                            title: Text(_title(row)),
                            subtitle: Text(_subtitle(row)),
                            trailing: const Icon(Icons.chevron_left),
                            onTap: () => _open(row)));
                  }));
        }
        if (widget.path == '/users/me')
          return ListView(padding: const EdgeInsets.all(16), children: [
            Card(
                child: ListTile(
                    leading: const CircleAvatar(child: Icon(Icons.person)),
                    title: Text((data['fullName'] ?? data['name'] ?? 'حسابي')
                        .toString()),
                    subtitle: Text((data['email'] ?? '').toString()))),
            for (final e in data.entries)
              Card(
                  child: ListTile(
                      title: Text(e.key), subtitle: Text(e.value.toString())))
          ]);
        return ListView(padding: const EdgeInsets.all(16), children: [
          for (final e in data.entries)
            Card(
                child: ListTile(
                    title: Text(e.key), subtitle: Text(e.value.toString())))
        ]);
      });
}

class _InstructorRosterPage extends StatefulWidget {
  const _InstructorRosterPage({required this.openingId});
  final String openingId;
  @override
  State<_InstructorRosterPage> createState() => _InstructorRosterPageState();
}

class _InstructorRosterPageState extends State<_InstructorRosterPage> {
  late Future<Map<String, dynamic>> future;
  final search = TextEditingController();
  @override
  void initState() {
    super.initState();
    _reload();
  }

  @override
  void dispose() {
    search.dispose();
    super.dispose();
  }

  void _reload() {
    future = LaxaApi.get('/openings/' + widget.openingId + '/roster');
    if (mounted) setState(() {});
  }

  Future<void> _grade(String enrollmentId, Map<String, dynamic> assessment,
      Map<String, dynamic>? current) async {
    final score =
        TextEditingController(text: current?['score']?.toString() ?? '');
    final notes =
        TextEditingController(text: current?['notes']?.toString() ?? '');
    final result = await showDialog<Map<String, dynamic>>(
        context: context,
        builder: (c) => AlertDialog(
                title: Text((assessment['nameAr'] ?? 'تسجيل درجة').toString()),
                content: Column(mainAxisSize: MainAxisSize.min, children: [
                  Text('الدرجة القصوى: ' +
                      (assessment['maxScore'] ?? 100).toString()),
                  TextField(
                      controller: score,
                      keyboardType:
                          const TextInputType.numberWithOptions(decimal: true),
                      decoration: const InputDecoration(labelText: 'الدرجة')),
                  TextField(
                      controller: notes,
                      maxLines: 3,
                      decoration: const InputDecoration(labelText: 'ملاحظات'))
                ]),
                actions: [
                  TextButton(
                      onPressed: () => Navigator.pop(c),
                      child: const Text('إلغاء')),
                  FilledButton(
                      onPressed: () {
                        final n = double.tryParse(score.text.trim());
                        final max =
                            (assessment['maxScore'] as num?)?.toDouble() ?? 100;
                        if (n == null || n < 0 || n > max) return;
                        Navigator.pop(
                            c, {'score': n, 'notes': notes.text.trim()});
                      },
                      child: const Text('حفظ'))
                ]));
    score.dispose();
    notes.dispose();
    if (result == null) return;
    try {
      await LaxaApi.mutate('PUT', '/grades', body: {
        'enrollmentId': enrollmentId,
        'assessmentId': assessment['id'],
        ...result
      });
      _reload();
    } catch (e) {
      if (mounted)
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
      appBar: AppBar(title: const Text('قائمة الطلاب والدرجات')),
      body: FutureBuilder<Map<String, dynamic>>(
          future: future,
          builder: (c, s) {
            if (s.connectionState != ConnectionState.done)
              return const Center(child: CircularProgressIndicator());
            if (s.hasError) return Center(child: Text(s.error.toString()));
            final data = s.data ?? {};
            final assessments = (data['assessments'] is List
                    ? data['assessments'] as List
                    : <dynamic>[])
                .whereType<Map>()
                .map((x) => Map<String, dynamic>.from(x))
                .toList();
            final enrollments = (data['enrollments'] is List
                    ? data['enrollments'] as List
                    : <dynamic>[])
                .whereType<Map>()
                .map((x) => Map<String, dynamic>.from(x))
                .where((x) {
              final student = x['student'] is Map ? x['student'] as Map : {};
              return search.text.trim().isEmpty ||
                  (student['email'] ?? '')
                      .toString()
                      .toLowerCase()
                      .contains(search.text.trim().toLowerCase());
            }).toList();
            return Column(children: [
              Padding(
                  padding: const EdgeInsets.all(14),
                  child: TextField(
                      controller: search,
                      onChanged: (_) => setState(() {}),
                      decoration: const InputDecoration(
                          prefixIcon: Icon(Icons.search),
                          labelText: 'بحث بالبريد الإلكتروني'))),
              Expanded(
                  child: enrollments.isEmpty
                      ? const Center(child: Text('لا يوجد طلاب لهذه الدفعة'))
                      : ListView(children: [
                          for (final enrollment in enrollments)
                            Builder(builder: (c) {
                              final student = enrollment['student'] is Map
                                  ? Map<String, dynamic>.from(
                                      enrollment['student'])
                                  : <String, dynamic>{};
                              final grades = enrollment['grades'] is List
                                  ? enrollment['grades'] as List
                                  : <dynamic>[];
                              return Card(
                                  margin: const EdgeInsets.symmetric(
                                      horizontal: 12, vertical: 5),
                                  child: ExpansionTile(
                                      title: Text((student['email'] ?? 'طالب')
                                          .toString()),
                                      subtitle: Text('الحالة: ' +
                                          (enrollment['status'] ?? '')
                                              .toString()),
                                      children: [
                                        if (assessments.isEmpty)
                                          const Padding(
                                              padding: EdgeInsets.all(12),
                                              child: Text(
                                                  'أضف مكونات التقييم أولاً')),
                                        for (final item in assessments)
                                          Builder(builder: (c) {
                                            final a = item;
                                            Map<String, dynamic>? current;
                                            for (final grade in grades) {
                                              if (grade is Map &&
                                                  grade['assessmentId'] ==
                                                      a['id']) {
                                                current =
                                                    Map<String, dynamic>.from(
                                                        grade);
                                                break;
                                              }
                                            }
                                            return ListTile(
                                                title: Text((a['nameAr'] ??
                                                        a['nameEn'] ??
                                                        'تقييم')
                                                    .toString()),
                                                subtitle: Text(current == null
                                                    ? 'لم ترصد درجة'
                                                    : 'الدرجة: ' +
                                                        current['score']
                                                            .toString() +
                                                        ' / ' +
                                                        (a['maxScore'] ?? 100)
                                                            .toString()),
                                                trailing: const Icon(
                                                    Icons.edit_outlined),
                                                onTap: () => _grade(
                                                    enrollment['id'].toString(),
                                                    a,
                                                    current));
                                          })
                                      ]));
                            })
                        ]))
            ]);
          }));
}

class _InstructorTasksPage extends StatefulWidget {
  const _InstructorTasksPage({required this.openingId});
  final String openingId;
  @override
  State<_InstructorTasksPage> createState() => _InstructorTasksPageState();
}

class _InstructorTasksPageState extends State<_InstructorTasksPage> {
  late Future<Map<String, dynamic>> future;
  @override
  void initState() {
    super.initState();
    _reload();
  }

  void _reload() {
    future = LaxaApi.get('/tasks/opening/' + widget.openingId);
    if (mounted) setState(() {});
  }

  List<dynamic> _items(Map<String, dynamic> data) =>
      (data['data'] ?? data['items'] ?? data['tasks'] ?? []) is List
          ? (data['data'] ?? data['items'] ?? data['tasks'] ?? []) as List
          : <dynamic>[];
  Future<void> _create() async {
    final ar = TextEditingController();
    final en = TextEditingController();
    final desc = TextEditingController();
    final max = TextEditingController(text: '100');
    final result = await showDialog<Map<String, dynamic>>(
        context: context,
        builder: (c) => AlertDialog(
                title: const Text('إنشاء مهمة'),
                content: SingleChildScrollView(
                    child: Column(mainAxisSize: MainAxisSize.min, children: [
                  TextField(
                      controller: ar,
                      decoration:
                          const InputDecoration(labelText: 'العنوان بالعربية')),
                  TextField(
                      controller: en,
                      decoration: const InputDecoration(
                          labelText: 'العنوان بالإنجليزية')),
                  TextField(
                      controller: desc,
                      maxLines: 3,
                      decoration:
                          const InputDecoration(labelText: 'وصف المهمة')),
                  TextField(
                      controller: max,
                      keyboardType: TextInputType.number,
                      decoration:
                          const InputDecoration(labelText: 'الدرجة القصوى'))
                ])),
                actions: [
                  TextButton(
                      onPressed: () => Navigator.pop(c),
                      child: const Text('إلغاء')),
                  FilledButton(
                      onPressed: () {
                        final score = double.tryParse(max.text);
                        if (ar.text.trim().isEmpty ||
                            en.text.trim().isEmpty ||
                            score == null ||
                            score <= 0) return;
                        Navigator.pop(c, {
                          'titleAr': ar.text.trim(),
                          'titleEn': en.text.trim(),
                          'descriptionAr': desc.text.trim(),
                          'descriptionEn': desc.text.trim(),
                          'maxScore': score
                        });
                      },
                      child: const Text('إنشاء'))
                ]));
    ar.dispose();
    en.dispose();
    desc.dispose();
    max.dispose();
    if (result == null) return;
    try {
      await LaxaApi.mutate('POST', '/tasks/opening/' + widget.openingId,
          body: result);
      _reload();
    } catch (e) {
      if (mounted)
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
      appBar: AppBar(title: const Text('مهام الدفعة')),
      floatingActionButton: FloatingActionButton.extended(
          onPressed: _create,
          icon: const Icon(Icons.add),
          label: const Text('مهمة جديدة')),
      body: FutureBuilder<Map<String, dynamic>>(
          future: future,
          builder: (c, s) {
            if (s.connectionState != ConnectionState.done)
              return const Center(child: CircularProgressIndicator());
            if (s.hasError) return Center(child: Text(s.error.toString()));
            final tasks = _items(s.data ?? {});
            if (tasks.isEmpty)
              return const Center(child: Text('لا توجد مهام بعد'));
            return RefreshIndicator(
                onRefresh: () async => _reload(),
                child: ListView(children: [
                  for (final item in tasks)
                    if (item is Map)
                      Card(
                          child: ListTile(
                        title: Text(
                            (item['titleAr'] ?? item['titleEn'] ?? 'مهمة')
                                .toString()),
                        subtitle: Text('التسليمات: ' +
                            ((item['submissions'] as List?)?.length ?? 0)
                                .toString() +
                            ' · الدرجة القصوى: ' +
                            (item['maxScore'] ?? 100).toString()),
                      ))
                ]));
          }));
}

class _StudentTasksPage extends StatefulWidget {
  const _StudentTasksPage();
  @override
  State<_StudentTasksPage> createState() => _StudentTasksPageState();
}

class _StudentTasksPageState extends State<_StudentTasksPage> {
  late Future<Map<String, dynamic>> enrollments;
  late Future<Map<String, dynamic>> tasks;
  String? openingId;
  @override
  void initState() {
    super.initState();
    enrollments = LaxaApi.get('/enrollments/my');
    tasks = Future.value({'data': <dynamic>[]});
  }

  List<dynamic> _items(Map<String, dynamic> data) => (data['data'] ??
          data['items'] ??
          data['enrollments'] ??
          data['tasks'] ??
          []) is List
      ? (data['data'] ??
          data['items'] ??
          data['enrollments'] ??
          data['tasks'] ??
          []) as List
      : <dynamic>[];
  Future<void> _submit(Map<String, dynamic> task) async {
    final id = task['id'].toString();
    final existing =
        task['submissions'] is List && (task['submissions'] as List).isNotEmpty
            ? Map<String, dynamic>.from(task['submissions'][0] as Map)
            : <String, dynamic>{};
    final answer =
        TextEditingController(text: (existing['content'] ?? '').toString());
    PlatformFile? file;
    final data = await showDialog<Map<String, dynamic>>(
        context: context,
        builder: (c) => StatefulBuilder(
            builder: (c, setDialog) => AlertDialog(
                  title: Text((task['titleAr'] ?? 'تسليم المهمة').toString()),
                  content: SingleChildScrollView(
                      child: Column(mainAxisSize: MainAxisSize.min, children: [
                    if (task['descriptionAr'] != null)
                      Text(task['descriptionAr'].toString()),
                    TextField(
                        controller: answer,
                        minLines: 3,
                        maxLines: 7,
                        decoration: const InputDecoration(labelText: 'إجابتك')),
                    OutlinedButton.icon(
                        onPressed: () async {
                          final picked = await FilePicker.platform
                              .pickFiles(type: FileType.any, withData: true);
                          if (picked != null && picked.files.isNotEmpty) {
                            if (picked.files.first.size > 50 * 1024 * 1024) {
                              if (c.mounted)
                                ScaffoldMessenger.of(c).showSnackBar(
                                    const SnackBar(
                                        content:
                                            Text('الحد الأعلى 50 ميجابايت')));
                            } else {
                              setDialog(() => file = picked.files.first);
                            }
                          }
                        },
                        icon: const Icon(Icons.attach_file),
                        label: Text(file?.name ?? 'إرفاق ملف اختياري'))
                  ])),
                  actions: [
                    TextButton(
                        onPressed: () => Navigator.pop(c),
                        child: const Text('إلغاء')),
                    FilledButton(
                        onPressed: () {
                          if (answer.text.trim().isEmpty &&
                              file == null &&
                              existing['attachmentUrl'] == null) return;
                          Navigator.pop(
                              c, {'content': answer.text.trim(), 'file': file});
                        },
                        child: const Text('إرسال'))
                  ],
                )));
    answer.dispose();
    if (data == null) return;
    try {
      Map<String, dynamic>? uploaded;
      if (data['file'] is PlatformFile)
        uploaded =
            await LaxaApi.uploadTaskFile(id, data['file'] as PlatformFile);
      final body = <String, dynamic>{'content': data['content']};
      if (uploaded != null)
        body.addAll({
          'attachmentUrl': uploaded['url'],
          'attachmentName': uploaded['name'],
          'attachmentType': uploaded['mimetype'],
          'attachmentSize': uploaded['size']
        });
      else if (existing['attachmentUrl'] != null)
        body.addAll({
          'attachmentUrl': existing['attachmentUrl'],
          'attachmentName': existing['attachmentName'],
          'attachmentType': existing['attachmentType'],
          'attachmentSize': existing['attachmentSize']
        });
      await LaxaApi.mutate('POST', '/tasks/' + id + '/submit', body: body);
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('تم إرسال المهمة')));
        if (openingId != null)
          setState(() => tasks = LaxaApi.get('/tasks/opening/' + openingId!));
      }
    } catch (e) {
      if (mounted)
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<Map<String, dynamic>>(
      future: enrollments,
      builder: (c, e) {
        if (e.connectionState != ConnectionState.done)
          return const Center(child: CircularProgressIndicator());
        if (e.hasError) return Center(child: Text(e.error.toString()));
        final enrolled = _items(e.data ?? {})
            .whereType<Map>()
            .map((x) => Map<String, dynamic>.from(x))
            .where((x) =>
                x['opening'] is Map &&
                x['opening']['id'] != null &&
                x['status'] != 'REJECTED')
            .toList();
        return Column(children: [
          Padding(
              padding: const EdgeInsets.all(16),
              child: DropdownButtonFormField<String>(
                value: openingId,
                isExpanded: true,
                decoration:
                    const InputDecoration(labelText: 'اختر الدورة والدفعة'),
                items: [
                  for (final x in enrolled)
                    DropdownMenuItem(
                        value: x['opening']['id'].toString(),
                        child: Text((x['course']?['titleAr'] ??
                                x['course']?['titleEn'] ??
                                'دورة')
                            .toString()))
                ],
                onChanged: (v) {
                  if (v != null)
                    setState(() {
                      openingId = v;
                      tasks = LaxaApi.get('/tasks/opening/' + v);
                    });
                },
              )),
          Expanded(
              child: FutureBuilder<Map<String, dynamic>>(
                  future: tasks,
                  builder: (c, s) {
                    if (s.connectionState != ConnectionState.done)
                      return const Center(child: CircularProgressIndicator());
                    if (s.hasError)
                      return Center(child: Text(s.error.toString()));
                    final rows = _items(s.data ?? {});
                    if (rows.isEmpty)
                      return const Center(
                          child: Text('لا توجد مهام لهذه الدفعة'));
                    return RefreshIndicator(
                        onRefresh: () async {
                          if (openingId != null)
                            setState(() => tasks =
                                LaxaApi.get('/tasks/opening/' + openingId!));
                        },
                        child: ListView(children: [
                          for (final x in rows)
                            if (x is Map)
                              Builder(builder: (c) {
                                final task = Map<String, dynamic>.from(x);
                                final submissions = task['submissions'] is List
                                    ? task['submissions'] as List
                                    : <dynamic>[];
                                final sub = submissions.isEmpty
                                    ? <String, dynamic>{}
                                    : Map<String, dynamic>.from(
                                        submissions.first as Map);
                                return Card(
                                    margin: const EdgeInsets.all(10),
                                    child: ExpansionTile(
                                      title: Text((task['titleAr'] ??
                                              task['titleEn'] ??
                                              'مهمة')
                                          .toString()),
                                      subtitle: Text('الدرجة القصوى: ' +
                                          (task['maxScore'] ?? 100).toString() +
                                          (sub['score'] == null
                                              ? ' · بانتظار التقييم أو التسليم'
                                              : ' · درجتك: ' +
                                                  sub['score'].toString())),
                                      children: [
                                        if (task['descriptionAr'] != null)
                                          Padding(
                                              padding: const EdgeInsets.all(12),
                                              child: Text(task['descriptionAr']
                                                  .toString())),
                                        if (sub['notes'] != null)
                                          ListTile(
                                              title:
                                                  const Text('ملاحظات المدرس'),
                                              subtitle: Text(
                                                  sub['notes'].toString())),
                                        Padding(
                                            padding: const EdgeInsets.all(12),
                                            child: FilledButton.icon(
                                                onPressed: () => _submit(task),
                                                icon: const Icon(
                                                    Icons.upload_file),
                                                label: Text(sub.isEmpty
                                                    ? 'تسليم المهمة'
                                                    : 'تحديث التسليم')))
                                      ],
                                    ));
                              })
                        ]));
                  }))
        ]);
      });
}

class _AssessmentsPage extends StatefulWidget {
  const _AssessmentsPage({required this.openingId, required this.profile});
  final String openingId;
  final Map<String, dynamic> profile;

  @override
  State<_AssessmentsPage> createState() => _AssessmentsPageState();
}

class _AssessmentsPageState extends State<_AssessmentsPage> {
  late Future<Map<String, dynamic>> future;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  void _reload() {
    future = LaxaApi.get('/openings/' + widget.openingId + '/assessments');
    if (mounted) setState(() {});
  }

  List<dynamic> _items(Map<String, dynamic> data) {
    for (final key in ['data', 'items', 'assessments']) {
      if (data[key] is List) return data[key] as List;
    }
    return [];
  }

  Future<void> _create() async {
    final ar = TextEditingController();
    final en = TextEditingController();
    final maximum = TextEditingController(text: '100');
    final result = await showDialog<Map<String, dynamic>>(
        context: context,
        builder: (context) => AlertDialog(
              title: const Text('إضافة مكون تقييم'),
              content: SingleChildScrollView(
                  child: Column(mainAxisSize: MainAxisSize.min, children: [
                TextField(
                    controller: ar,
                    decoration:
                        const InputDecoration(labelText: 'الاسم بالعربية')),
                TextField(
                    controller: en,
                    decoration:
                        const InputDecoration(labelText: 'الاسم بالإنجليزية')),
                TextField(
                    controller: maximum,
                    keyboardType:
                        const TextInputType.numberWithOptions(decimal: true),
                    decoration:
                        const InputDecoration(labelText: 'الدرجة القصوى')),
              ])),
              actions: [
                TextButton(
                    onPressed: () => Navigator.pop(context),
                    child: const Text('إلغاء')),
                FilledButton(
                    onPressed: () {
                      final maxScore = double.tryParse(maximum.text.trim());
                      if (ar.text.trim().isEmpty ||
                          en.text.trim().isEmpty ||
                          maxScore == null ||
                          maxScore <= 0) {
                        ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                                content: Text('أكمل الحقول وأدخل درجة صحيحة')));
                        return;
                      }
                      Navigator.pop(context, {
                        'nameAr': ar.text.trim(),
                        'nameEn': en.text.trim(),
                        'maxScore': maxScore
                      });
                    },
                    child: const Text('إضافة')),
              ],
            ));
    ar.dispose();
    en.dispose();
    maximum.dispose();
    if (result == null) return;
    try {
      await LaxaApi.mutate(
          'POST', '/openings/' + widget.openingId + '/assessments',
          body: result);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('تمت إضافة مكون التقييم')));
        _reload();
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.toString())));
      }
    }
  }

  Future<void> _delete(Map<String, dynamic> item) async {
    final id = item['id']?.toString();
    if (id == null) return;
    final confirmed = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
              title: const Text('حذف مكون التقييم'),
              content: Text((item['nameAr'] ?? 'هذا المكون').toString()),
              actions: [
                TextButton(
                    onPressed: () => Navigator.pop(context, false),
                    child: const Text('إلغاء')),
                FilledButton(
                    onPressed: () => Navigator.pop(context, true),
                    child: const Text('حذف')),
              ],
            ));
    if (confirmed != true) return;
    try {
      await LaxaApi.mutate('DELETE', '/assessments/' + id);
      _reload();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.toString())));
      }
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('مكونات التقييم')),
        floatingActionButton: FloatingActionButton.extended(
            onPressed: _create,
            icon: const Icon(Icons.add),
            label: const Text('إضافة مكون')),
        body: FutureBuilder<Map<String, dynamic>>(
            future: future,
            builder: (context, snapshot) {
              if (snapshot.connectionState != ConnectionState.done) {
                return const Center(child: CircularProgressIndicator());
              }
              if (snapshot.hasError) {
                return Center(
                    child: Column(mainAxisSize: MainAxisSize.min, children: [
                  Text(snapshot.error.toString()),
                  TextButton(
                      onPressed: _reload, child: const Text('إعادة المحاولة'))
                ]));
              }
              final items = _items(snapshot.data ?? {});
              if (items.isEmpty) {
                return const Center(
                    child: Text('لا توجد مكونات تقييم لهذه الدفعة'));
              }
              return RefreshIndicator(
                  onRefresh: () async => _reload(),
                  child: ListView(children: [
                    for (final value in items)
                      if (value is Map)
                        Card(
                            child: ListTile(
                                title: Text((value['nameAr'] ??
                                        value['nameEn'] ??
                                        'مكون تقييم')
                                    .toString()),
                                subtitle: Text('الدرجة القصوى: ' +
                                    (value['maxScore'] ?? '—').toString()),
                                trailing: IconButton(
                                    tooltip: 'حذف',
                                    onPressed: () => _delete(
                                        Map<String, dynamic>.from(value)),
                                    icon: const Icon(Icons.delete_outline))))
                  ]));
            }),
      );
}

class _ReceiptPreviewPage extends StatefulWidget {
  const _ReceiptPreviewPage({required this.enrollmentId, required this.title});
  final String enrollmentId, title;
  @override
  State<_ReceiptPreviewPage> createState() => _ReceiptPreviewPageState();
}

class _ReceiptPreviewPageState extends State<_ReceiptPreviewPage> {
  late Future<Uint8List> future;
  PdfControllerPinch? controller;
  @override
  void initState() {
    super.initState();
    future =
        LaxaApi.getBytes('/enrollments/' + widget.enrollmentId + '/receipt');
  }

  bool _pdf(Uint8List bytes) =>
      bytes.length > 4 &&
      bytes[0] == 37 &&
      bytes[1] == 80 &&
      bytes[2] == 68 &&
      bytes[3] == 70;
  @override
  Widget build(BuildContext context) => Scaffold(
      appBar: AppBar(title: Text('الإيصال | ' + widget.title)),
      body: FutureBuilder<Uint8List>(
          future: future,
          builder: (context, s) {
            if (s.connectionState != ConnectionState.done)
              return const Center(child: CircularProgressIndicator());
            if (s.hasError)
              return Center(
                  child: Padding(
                      padding: const EdgeInsets.all(20),
                      child: Text(s.error.toString(),
                          textAlign: TextAlign.center)));
            final bytes = s.data!;
            if (_pdf(bytes)) {
              controller ??=
                  PdfControllerPinch(document: PdfDocument.openData(bytes));
              return PdfViewPinch(controller: controller!);
            }
            return InteractiveViewer(
                child: Center(
                    child: Image.memory(bytes,
                        errorBuilder: (_, __, ___) =>
                            const Text('تنسيق الإيصال غير مدعوم'))));
          }));
  @override
  void dispose() {
    controller?.dispose();
    super.dispose();
  }
}

class _RefundFormData {
  const _RefundFormData(
      this.method, this.accountName, this.accountNumber, this.note);
  final String method, accountName, accountNumber, note;
}

class _RefundRequestDialog extends StatefulWidget {
  const _RefundRequestDialog();
  @override
  State<_RefundRequestDialog> createState() => _RefundRequestDialogState();
}

class _RefundRequestDialogState extends State<_RefundRequestDialog> {
  final name = TextEditingController(),
      account = TextEditingController(),
      note = TextEditingController();
  String method = 'BANK';
  String? error;
  @override
  Widget build(BuildContext context) => AlertDialog(
        title: const Text('طلب استرداد'),
        content: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, children: [
          DropdownButtonFormField<String>(
              value: method,
              decoration: const InputDecoration(labelText: 'طريقة الاسترداد'),
              items: const [
                DropdownMenuItem(value: 'BANK', child: Text('تحويل بنكي')),
                DropdownMenuItem(
                    value: 'WALLET', child: Text('محفظة إلكترونية')),
              ],
              onChanged: (v) => setState(() => method = v ?? 'BANK')),
          TextField(
              controller: name,
              decoration: const InputDecoration(labelText: 'اسم صاحب الحساب')),
          TextField(
              controller: account,
              decoration:
                  const InputDecoration(labelText: 'رقم الحساب أو IBAN')),
          TextField(
              controller: note,
              decoration: const InputDecoration(labelText: 'ملاحظة (اختياري)')),
          if (error != null)
            Text(error!, style: const TextStyle(color: Colors.red)),
        ])),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('إلغاء')),
          FilledButton(
              onPressed: () {
                if (name.text.trim().isEmpty || account.text.trim().isEmpty) {
                  setState(() => error = 'أدخل اسم صاحب الحساب ورقم الحساب');
                  return;
                }
                Navigator.pop(
                    context,
                    _RefundFormData(method, name.text.trim(),
                        account.text.trim(), note.text.trim()));
              },
              child: const Text('إرسال الطلب')),
        ],
      );
  @override
  void dispose() {
    name.dispose();
    account.dispose();
    note.dispose();
    super.dispose();
  }
}

class _ConversationPage extends StatefulWidget {
  const _ConversationPage({required this.other, required this.course});
  final Map<String, dynamic> other;
  final Map<String, dynamic>? course;
  @override
  State<_ConversationPage> createState() => _ConversationPageState();
}

class _ConversationPageState extends State<_ConversationPage> {
  final input = TextEditingController();
  late Future<Map<String, dynamic>> future;
  String get otherId => widget.other['id'].toString();
  String get courseId => widget.course?['id']?.toString() ?? '';
  String get path =>
      '/messages/thread?' +
      Uri(queryParameters: {
        'with': otherId,
        if (courseId.isNotEmpty) 'courseId': courseId
      }).query;
  @override
  void initState() {
    super.initState();
    future = LaxaApi.get(path);
    _markRead();
  }

  Future<void> _markRead() async {
    try {
      await LaxaApi.mutate(
          'PATCH',
          '/messages/read?' +
              Uri(queryParameters: {
                'with': otherId,
                if (courseId.isNotEmpty) 'courseId': courseId
              }).query);
    } catch (_) {}
  }

  void _reload() {
    setState(() => future = LaxaApi.get(path));
  }

  Future<void> _send() async {
    final text = input.text.trim();
    if (text.isEmpty) return;
    input.clear();
    try {
      await LaxaApi.mutate('POST', '/messages', body: {
        'recipientId': otherId,
        'content': text,
        if (courseId.isNotEmpty) 'courseId': courseId
      });
      _reload();
    } catch (e) {
      if (mounted)
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  List<dynamic> _messages(Map<String, dynamic> data) {
    if (data['data'] is List) return data['data'];
    if (data['messages'] is List) return data['messages'];
    return [];
  }

  @override
  Widget build(BuildContext context) => Scaffold(
      appBar: AppBar(
          title: Text(widget.other['email']?.toString() ?? 'المحادثة'),
          bottom: widget.course == null
              ? null
              : PreferredSize(
                  preferredSize: const Size.fromHeight(28),
                  child: Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Text(
                          widget.course!['titleAr']?.toString() ?? 'مقرر')))),
      body: Column(children: [
        Expanded(
            child: FutureBuilder<Map<String, dynamic>>(
                future: future,
                builder: (context, s) {
                  if (s.connectionState != ConnectionState.done)
                    return const Center(child: CircularProgressIndicator());
                  if (s.hasError)
                    return Center(child: Text(s.error.toString()));
                  final rows = _messages(s.data ?? {});
                  if (rows.isEmpty)
                    return const Center(
                        child: Text('ابدأ المحادثة بإرسال رسالة'));
                  return ListView.builder(
                      padding: const EdgeInsets.all(12),
                      itemCount: rows.length,
                      itemBuilder: (context, i) {
                        final row = Map<String, dynamic>.from(rows[i] as Map);
                        final sender = row['sender'];
                        final mine =
                            sender is Map && sender['id'] != widget.other['id'];
                        return Align(
                            alignment: mine
                                ? Alignment.centerRight
                                : Alignment.centerLeft,
                            child: Container(
                                margin: const EdgeInsets.symmetric(vertical: 4),
                                padding: const EdgeInsets.all(12),
                                constraints:
                                    const BoxConstraints(maxWidth: 320),
                                decoration: BoxDecoration(
                                    color: mine
                                        ? const Color(0xff142641)
                                        : Colors.white,
                                    borderRadius: BorderRadius.circular(14)),
                                child: Text(row['content']?.toString() ?? '',
                                    style: TextStyle(
                                        color: mine
                                            ? Colors.white
                                            : Colors.black87))));
                      });
                })),
        SafeArea(
            child: Padding(
                padding: const EdgeInsets.all(10),
                child: Row(children: [
                  Expanded(
                      child: TextField(
                          controller: input,
                          decoration: const InputDecoration(
                              hintText: 'اكتب رسالتك',
                              border: OutlineInputBorder()),
                          onSubmitted: (_) => _send())),
                  const SizedBox(width: 8),
                  IconButton.filled(
                      onPressed: _send, icon: const Icon(Icons.send))
                ])))
      ]));
  @override
  void dispose() {
    input.dispose();
    super.dispose();
  }
}

class _ReceiptEnrollmentData {
  const _ReceiptEnrollmentData(this.file, this.coupon);
  final PlatformFile file;
  final String? coupon;
}

class _ReceiptEnrollmentDialog extends StatefulWidget {
  const _ReceiptEnrollmentDialog();
  @override
  State<_ReceiptEnrollmentDialog> createState() =>
      _ReceiptEnrollmentDialogState();
}

class _ReceiptEnrollmentDialogState extends State<_ReceiptEnrollmentDialog> {
  final coupon = TextEditingController();
  PlatformFile? file;
  String? error;
  Future<void> pick() async {
    try {
      final result = await FilePicker.platform.pickFiles(
          type: FileType.custom,
          allowedExtensions: const ['jpg', 'jpeg', 'png', 'pdf'],
          allowMultiple: false,
          withData: true);
      if (result == null || result.files.isEmpty) return;
      final selected = result.files.single;
      if (selected.size > 5 * 1024 * 1024) {
        setState(() => error = 'الحد الأعلى لحجم الملف 5 ميغابايت');
        return;
      }
      if (selected.bytes == null) {
        setState(() => error = 'تعذر قراءة الملف المختار');
        return;
      }
      setState(() => {file = selected, error = null});
    } catch (e) {
      setState(() => error = e.toString());
    }
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: const Text('إرفاق إيصال الدفع'),
        content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                  'الصيغ المقبولة PDF أو JPG أو PNG، بحد أقصى 5 ميغابايت.'),
              const SizedBox(height: 12),
              OutlinedButton.icon(
                  onPressed: pick,
                  icon: const Icon(Icons.attach_file),
                  label: Text(file?.name ?? 'اختيار ملف إيصال')),
              TextField(
                  controller: coupon,
                  decoration: const InputDecoration(
                      labelText: 'رمز القسيمة (اختياري)')),
              if (error != null)
                Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text(error!,
                        style: const TextStyle(color: Colors.red))),
            ]),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('إلغاء')),
          FilledButton(
              onPressed: file == null
                  ? null
                  : () => Navigator.pop(context,
                      _ReceiptEnrollmentData(file!, coupon.text.trim())),
              child: const Text('إرسال الطلب')),
        ],
      );
  @override
  void dispose() {
    coupon.dispose();
    super.dispose();
  }
}
