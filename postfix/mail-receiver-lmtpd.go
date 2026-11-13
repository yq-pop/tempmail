// Package main: LMTP 守护进程版 mail-receiver。
//
// 替代原本每封邮件 fork 一次 Go 二进制的 pipe 模式：
//  1. Postfix 把虚拟域名邮件转发到本进程的 unix socket（LMTP）
//  2. 本进程长期常驻，单进程并发处理多条 LMTP 会话
//  3. 解析邮件后调 API /internal/deliver 入库
//  4. 入库失败时返回 LMTP 4xx，Postfix 把邮件保留在队列里自动重试，不会丢失
//
// 协议参考 RFC 2033 (LMTP)。Postfix 支持把这种 socket 当成 transport。
//
// 启动参数（环境变量）：
//
//	API_URL          API 地址，默认 http://api:8080
//	INTERNAL_TOKEN   调用 /internal/* 的共享密钥（必填，需与 API 一致）
//	LMTPD_SOCKET     unix socket 路径，默认 /var/run/postfix/mail-receiver.sock
//	LMTPD_BIND       可选 TCP 监听 host:port，调试用
//	LMTPD_HOSTNAME   LMTP banner 中的主机名
package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	"net"
	"net/http"
	"net/mail"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"golang.org/x/text/encoding"
	"golang.org/x/text/encoding/htmlindex"
)

const (
	maxMessageBytes       = 25 << 20
	maxBatchResponseBytes = 4 << 20
	apiTimeout            = 15 * time.Second

	// internalTokenHeader 与 API 侧 middleware.InternalTokenHeader 保持一致。
	internalTokenHeader = "X-Internal-Token"
)

type deliverPayload struct {
	Recipient string `json:"recipient"`
	Sender    string `json:"sender"`
	Subject   string `json:"subject"`
	BodyText  string `json:"body_text"`
	BodyHTML  string `json:"body_html"`
	Raw       string `json:"raw"`
}

type deliverBatchPayload struct {
	Recipients []string `json:"recipients"`
	Sender     string   `json:"sender"`
	Subject    string   `json:"subject"`
	BodyText   string   `json:"body_text"`
	BodyHTML   string   `json:"body_html"`
	Raw        string   `json:"raw"`
}

type batchResult struct {
	Recipient string `json:"recipient"`
	Status    string `json:"status"`
	Reason    string `json:"reason"`
}

type batchResponse struct {
	Results []batchResult `json:"results"`
}

type server struct {
	hostname      string
	apiURL        string
	internalToken string
	httpClient    *http.Client
	conns         atomic.Int64
}

func main() {
	log.SetFlags(log.LstdFlags | log.Lmicroseconds)

	apiURL := strings.TrimRight(getenv("API_URL", "http://api:8080"), "/")
	hostname := getenv("LMTPD_HOSTNAME", "mail-receiver.local")
	internalToken := strings.TrimSpace(os.Getenv("INTERNAL_TOKEN"))
	if internalToken == "" {
		// 没有密钥时所有投递都会被 API 拒绝（401），邮件会一直堆在 Postfix 队列里，宁可启动时就明确失败。
		log.Fatal("INTERNAL_TOKEN is required: set the same value as the api service")
	}

	srv := &server{
		hostname:      hostname,
		apiURL:        apiURL,
		internalToken: internalToken,
		httpClient:    newAPIHTTPClient(),
	}

	listeners := make([]net.Listener, 0, 2)

	if sockPath := getenv("LMTPD_SOCKET", "/var/run/postfix/mail-receiver.sock"); sockPath != "" {
		_ = os.Remove(sockPath)
		l, err := net.Listen("unix", sockPath)
		if err != nil {
			log.Fatalf("listen unix %s: %v", sockPath, err)
		}
		// Postfix 默认以 postfix 用户连接，需要可写权限
		if err := os.Chmod(sockPath, 0o666); err != nil {
			log.Printf("chmod socket: %v", err)
		}
		log.Printf("LMTP listening on unix:%s", sockPath)
		listeners = append(listeners, l)
	}

	if bind := os.Getenv("LMTPD_BIND"); bind != "" {
		l, err := net.Listen("tcp", bind)
		if err != nil {
			log.Fatalf("listen tcp %s: %v", bind, err)
		}
		log.Printf("LMTP listening on tcp:%s", bind)
		listeners = append(listeners, l)
	}

	if len(listeners) == 0 {
		log.Fatal("no listener configured (LMTPD_SOCKET / LMTPD_BIND)")
	}

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	var wg sync.WaitGroup
	for _, l := range listeners {
		wg.Add(1)
		go func(l net.Listener) {
			defer wg.Done()
			srv.acceptLoop(ctx, l)
		}(l)
	}

	<-ctx.Done()
	log.Printf("shutting down, draining %d active conns", srv.conns.Load())
	for _, l := range listeners {
		_ = l.Close()
	}
	wg.Wait()
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getenvInt(key string, fallback int) int {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	v, err := strconv.Atoi(raw)
	if err != nil || v < 0 {
		log.Printf("invalid %s=%q, using %d", key, raw, fallback)
		return fallback
	}
	return v
}

func newAPIHTTPClient() *http.Client {
	maxIdle := getenvInt("LMTP_HTTP_MAX_IDLE_CONNS", 512)
	maxIdlePerHost := getenvInt("LMTP_HTTP_MAX_IDLE_CONNS_PER_HOST", 256)
	maxConnsPerHost := getenvInt("LMTP_HTTP_MAX_CONNS_PER_HOST", 512)

	return &http.Client{
		Timeout: apiTimeout,
		Transport: &http.Transport{
			Proxy: http.ProxyFromEnvironment,
			DialContext: (&net.Dialer{
				Timeout:   3 * time.Second,
				KeepAlive: 30 * time.Second,
			}).DialContext,
			MaxIdleConns:          maxIdle,
			MaxIdleConnsPerHost:   maxIdlePerHost,
			MaxConnsPerHost:       maxConnsPerHost,
			IdleConnTimeout:       90 * time.Second,
			ResponseHeaderTimeout: apiTimeout,
			ForceAttemptHTTP2:     false,
		},
	}
}

func (s *server) acceptLoop(ctx context.Context, l net.Listener) {
	for {
		conn, err := l.Accept()
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			if ne, ok := err.(net.Error); ok && ne.Temporary() {
				time.Sleep(50 * time.Millisecond)
				continue
			}
			log.Printf("accept: %v", err)
			return
		}
		s.conns.Add(1)
		go func() {
			defer s.conns.Add(-1)
			s.handle(ctx, conn)
		}()
	}
}

type session struct {
	srv        *server
	conn       net.Conn
	r          *bufio.Reader
	w          *bufio.Writer
	from       string
	recipients []string
}

func (s *server) handle(ctx context.Context, conn net.Conn) {
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(2 * time.Minute))

	sess := &session{
		srv:  s,
		conn: conn,
		r:    bufio.NewReaderSize(conn, 64*1024),
		w:    bufio.NewWriterSize(conn, 64*1024),
	}
	sess.writeLine("220 %s LMTP ready", s.hostname)

	for {
		line, err := sess.readLine()
		if err != nil {
			return
		}
		cmd, args := parseCommand(line)
		switch cmd {
		case "LHLO":
			sess.writeLine("250-%s", s.hostname)
			sess.writeLine("250-PIPELINING")
			sess.writeLine("250-8BITMIME")
			sess.writeLine("250-SIZE %d", maxMessageBytes)
			sess.writeLine("250 ENHANCEDSTATUSCODES")
		case "MAIL":
			sess.from = extractAddr(args)
			sess.recipients = sess.recipients[:0]
			sess.writeLine("250 2.1.0 OK")
		case "RCPT":
			addr := extractAddr(args)
			if addr == "" {
				sess.writeLine("501 5.1.3 bad recipient")
				continue
			}
			sess.recipients = append(sess.recipients, addr)
			sess.writeLine("250 2.1.5 OK")
		case "DATA":
			if len(sess.recipients) == 0 {
				sess.writeLine("503 5.5.1 no recipients")
				continue
			}
			sess.writeLine("354 end with <CR><LF>.<CR><LF>")
			data, err := sess.readData()
			if err != nil {
				return
			}
			sess.deliverAll(ctx, data)
			sess.from = ""
			sess.recipients = sess.recipients[:0]
			_ = sess.conn.SetDeadline(time.Now().Add(2 * time.Minute))
		case "RSET":
			sess.from = ""
			sess.recipients = sess.recipients[:0]
			sess.writeLine("250 2.1.5 OK")
		case "NOOP":
			sess.writeLine("250 2.0.0 OK")
		case "QUIT":
			sess.writeLine("221 2.0.0 bye")
			return
		case "":
			// 忽略空行
		default:
			sess.writeLine("502 5.5.2 unrecognized %q", cmd)
		}
	}
}

func (s *session) readLine() (string, error) {
	line, err := s.r.ReadString('\n')
	if err != nil {
		return "", err
	}
	return strings.TrimRight(line, "\r\n"), nil
}

func (s *session) writeLine(format string, args ...interface{}) {
	fmt.Fprintf(s.w, format, args...)
	s.w.WriteString("\r\n")
	_ = s.w.Flush()
}

func (s *session) readData() ([]byte, error) {
	var buf bytes.Buffer
	for {
		line, err := s.r.ReadBytes('\n')
		if err != nil {
			return nil, err
		}
		if bytes.Equal(line, []byte(".\r\n")) || bytes.Equal(line, []byte(".\n")) {
			break
		}
		// dot-stuffing
		if len(line) > 0 && line[0] == '.' {
			line = line[1:]
		}
		if buf.Len()+len(line) > maxMessageBytes {
			// 仍然继续读完，但只丢弃后续，最后再返回错误
			return nil, fmt.Errorf("message exceeds %d bytes", maxMessageBytes)
		}
		buf.Write(line)
	}
	return buf.Bytes(), nil
}

// headerDecoder 解码 RFC 2047 编码字（=?charset?B|Q?...?=），例如中文主题、
// 带非 ASCII 显示名的发件人。标准库只内置 UTF-8 / US-ASCII / ISO-8859-1，
// 其余字符集（GBK、Big5、Shift_JIS……）通过 charsetReader 转换。
var headerDecoder = &mime.WordDecoder{CharsetReader: charsetReader}

// charsetAliases 补充 WHATWG 标签表里没有、但真实邮件里会出现的字符集别名。
// 例如 Python 的 email 库会把 gb2312 写成 "eucgb2312_cn"，Windows 程序常写 cp936 / cp932。
// 键是规范化后的写法（小写、下划线换成连字符、去掉 "x-" 前缀）。
var charsetAliases = map[string]string{
	"eucgb2312-cn": "gbk", "euc-cn": "gbk", "euccn": "gbk", "cp936": "gbk", "ms936": "gbk",
	"cp950": "big5", "big5-eten": "big5",
	"cp932": "shift_jis", "ms932": "shift_jis",
	"eucjp": "euc-jp", "ujis": "euc-jp",
	"euckr": "euc-kr", "cp949": "euc-kr",
}

// lookupEncoding 按名称查找字符集：先按 WHATWG 标签表，再按 charsetAliases 的别名。
// 标签按 WHATWG 规则解析：gb2312 / gbk 都按 GBK 解码，iso-8859-1 / us-ascii 按 windows-1252 解码。
func lookupEncoding(label string) (encoding.Encoding, error) {
	label = strings.ToLower(strings.TrimSpace(label))
	if enc, err := htmlindex.Get(label); err == nil {
		return enc, nil
	}
	norm := strings.TrimPrefix(strings.ReplaceAll(label, "_", "-"), "x-")
	if alias, ok := charsetAliases[norm]; ok {
		norm = alias
	}
	return htmlindex.Get(norm)
}

// charsetReader 把指定字符集的输入转成 UTF-8，label 不认识时返回错误。
func charsetReader(label string, input io.Reader) (io.Reader, error) {
	enc, err := lookupEncoding(label)
	if err != nil {
		return nil, err
	}
	return enc.NewDecoder().Reader(input), nil
}

// decodeHeader 返回解码后的头部文本。遇到不认识的字符集时保留原文：
// 宁可显示未解码的主题，也不能因为头部异常而丢信。
func decodeHeader(v string) string {
	if !strings.Contains(v, "=?") {
		return v
	}
	decoded, err := headerDecoder.DecodeHeader(v)
	if err != nil {
		return v
	}
	return decoded
}

func (s *session) deliverAll(ctx context.Context, raw []byte) {
	msg, parseErr := mail.ReadMessage(bytes.NewReader(raw))
	var sender, subject, bodyText, bodyHTML string
	if parseErr == nil {
		sender = decodeHeader(msg.Header.Get("From"))
		subject = decodeHeader(msg.Header.Get("Subject"))
		bodyText, bodyHTML = extractBodies(msg)
	}
	if sender == "" {
		sender = s.from
	}

	rcpts := make([]string, 0, len(s.recipients))
	for _, r := range s.recipients {
		rcpts = append(rcpts, strings.ToLower(strings.TrimSpace(r)))
	}

	if len(rcpts) > 1 {
		results, err := s.srv.deliverBatch(ctx, deliverBatchPayload{
			Recipients: rcpts,
			Sender:     sender,
			Subject:    subject,
			BodyText:   bodyText,
			BodyHTML:   bodyHTML,
			Raw:        string(raw),
		})
		if err != nil {
			log.Printf("deliver-batch: %v", err)
			s.writeTemporaryFailures(len(rcpts))
			return
		}
		if err := validateBatchResults(rcpts, results); err != nil {
			log.Printf("deliver-batch invalid response: %v", err)
			s.writeTemporaryFailures(len(rcpts))
			return
		}
		for _, r := range results {
			s.writeLine("250 2.0.0 <%s> %s", r.Recipient, r.Status)
		}
		return
	}

	for _, rcpt := range rcpts {
		payload := deliverPayload{
			Recipient: rcpt,
			Sender:    sender,
			Subject:   subject,
			BodyText:  bodyText,
			BodyHTML:  bodyHTML,
			Raw:       string(raw),
		}
		if err := s.srv.deliver(ctx, payload); err != nil {
			log.Printf("deliver %s: %v", rcpt, err)
			s.writeLine("451 4.5.0 temporary delivery failure")
			continue
		}
		s.writeLine("250 2.0.0 <%s> accepted", rcpt)
	}
}

func (s *session) writeTemporaryFailures(count int) {
	for i := 0; i < count; i++ {
		s.writeLine("451 4.5.0 temporary delivery failure")
	}
}

func validateBatchResults(recipients []string, results []batchResult) error {
	if len(results) != len(recipients) {
		return fmt.Errorf("got %d results for %d recipients", len(results), len(recipients))
	}
	for i := range recipients {
		if !strings.EqualFold(strings.TrimSpace(results[i].Recipient), recipients[i]) {
			return fmt.Errorf("result %d recipient mismatch", i)
		}
		if results[i].Status != "delivered" && results[i].Status != "discarded" {
			return fmt.Errorf("result %d has invalid status %q", i, results[i].Status)
		}
	}
	return nil
}

func parseCommand(line string) (cmd, args string) {
	idx := strings.IndexAny(line, " \t")
	if idx == -1 {
		return strings.ToUpper(line), ""
	}
	return strings.ToUpper(line[:idx]), strings.TrimSpace(line[idx+1:])
}

func extractAddr(args string) string {
	idx := strings.IndexByte(args, ':')
	if idx == -1 {
		return ""
	}
	rest := strings.TrimSpace(args[idx+1:])
	rest = strings.TrimSpace(strings.SplitN(rest, " ", 2)[0])
	rest = strings.TrimPrefix(rest, "<")
	rest = strings.TrimSuffix(rest, ">")
	return rest
}

// newInternalRequest 构造调用 API 内部接口的 POST 请求，并带上共享密钥。
func (s *server) newInternalRequest(ctx context.Context, path string, body []byte) (*http.Request, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.apiURL+path, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(internalTokenHeader, s.internalToken)
	return req, nil
}

func (s *server) deliver(ctx context.Context, payload deliverPayload) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := s.newInternalRequest(ctx, "/internal/deliver", body)
	if err != nil {
		return err
	}

	res, err := s.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		respBody, _ := readAndDrain(res.Body, 1024)
		return fmt.Errorf("api HTTP %d: %s", res.StatusCode, strings.TrimSpace(string(respBody)))
	}
	_, err = readAndDrain(res.Body, 0)
	return err
}

func (s *server) deliverBatch(ctx context.Context, payload deliverBatchPayload) ([]batchResult, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	req, err := s.newInternalRequest(ctx, "/internal/deliver-batch", body)
	if err != nil {
		return nil, err
	}

	res, err := s.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	respBody, readErr := readAndDrain(res.Body, maxBatchResponseBytes)
	if readErr != nil {
		return nil, fmt.Errorf("read batch response: %w", readErr)
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, fmt.Errorf("api HTTP %d: %s", res.StatusCode, strings.TrimSpace(string(respBody)))
	}
	var parsed batchResponse
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return nil, fmt.Errorf("decode batch response: %w", err)
	}
	return parsed.Results, nil
}

// readAndDrain keeps HTTP/1.1 connections reusable. When limit is positive,
// only that many response bytes are retained while the remainder is discarded.
func readAndDrain(r io.Reader, limit int64) ([]byte, error) {
	var kept bytes.Buffer
	if limit > 0 {
		if _, err := io.Copy(&kept, io.LimitReader(r, limit)); err != nil {
			return nil, err
		}
	}
	if _, err := io.Copy(io.Discard, r); err != nil {
		return nil, err
	}
	return kept.Bytes(), nil
}

// extractBodies 取出邮件的纯文本与 HTML 正文，均已还原为 UTF-8：
// 先按 Content-Transfer-Encoding 解开 base64 / quoted-printable，再按 charset 转码。
// 此前这两步都没做，base64 编码的邮件（Gmail 转发、绝大多数验证码邮件）会把
// base64 原文当作正文存进数据库，GBK / Big5 等字符集的邮件则是乱码。
func extractBodies(msg *mail.Message) (string, string) {
	mediaType, params, err := mime.ParseMediaType(msg.Header.Get("Content-Type"))
	mediaType = strings.ToLower(mediaType)
	if err == nil && strings.HasPrefix(mediaType, "multipart/") {
		return extractMultipart(msg.Body, params["boundary"])
	}
	// 没有 Content-Type（或无法解析）按纯文本处理，与 RFC 2045 的默认值一致。
	// 单部分的非文本邮件（只有一个 PDF / 图片）没有可显示的正文，原始内容仍可在 RAW 页签查看；
	// 若把它按文本解码，二进制数据会进入数据库的 TEXT 字段。
	if err == nil && mediaType != "" && !strings.HasPrefix(mediaType, "text/") {
		return "", ""
	}
	body := decodeBody(msg.Body, msg.Header.Get("Content-Transfer-Encoding"), params["charset"])
	if mediaType == "text/html" {
		return "", body
	}
	return body, ""
}

func extractMultipart(r io.Reader, boundary string) (string, string) {
	if boundary == "" {
		body, _ := io.ReadAll(io.LimitReader(r, maxMessageBytes))
		return toUTF8(body, ""), ""
	}
	var textBody, htmlBody string
	mr := multipart.NewReader(r, boundary)
	for {
		part, err := mr.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			break
		}
		mediaType, params, _ := mime.ParseMediaType(part.Header.Get("Content-Type"))
		mediaType = strings.ToLower(mediaType)
		if strings.HasPrefix(mediaType, "multipart/") {
			nt, nh := extractMultipart(part, params["boundary"])
			if textBody == "" {
				textBody = nt
			}
			if htmlBody == "" {
				htmlBody = nh
			}
			continue
		}
		// 注意：multipart.Part 会自行解码 quoted-printable 并删除对应的编码头，
		// 所以这里读到的 Content-Transfer-Encoding 只可能是 base64 / 7bit / 8bit 等，不会重复解码。
		// 只读取真正会用到的部分，附件不必读进内存。
		cte := part.Header.Get("Content-Transfer-Encoding")
		switch mediaType {
		case "text/plain":
			if textBody == "" {
				textBody = decodeBody(part, cte, params["charset"])
			}
		case "text/html":
			if htmlBody == "" {
				htmlBody = decodeBody(part, cte, params["charset"])
			}
		}
	}
	return textBody, htmlBody
}

// decodeBody 读出一段正文：先按 Content-Transfer-Encoding 还原字节，再按 charset 转成 UTF-8。
// 解码出的 NUL 字节会被去掉：PostgreSQL 的 TEXT 字段不接受 NUL，
// 而 base64 解开后的内容不再像原来的 base64 文本那样保证没有 NUL。
func decodeBody(r io.Reader, cte, charset string) string {
	data, _ := io.ReadAll(io.LimitReader(r, maxMessageBytes))
	switch strings.ToLower(strings.TrimSpace(cte)) {
	case "base64":
		data = decodeBase64Lenient(data)
	case "quoted-printable":
		// 宽松解码：标准库把非法的 "=" 序列按字面量处理；真的出错时保留已解出的部分。
		if decoded, err := io.ReadAll(quotedprintable.NewReader(bytes.NewReader(data))); err == nil || len(decoded) > 0 {
			data = decoded
		}
	}
	return strings.ReplaceAll(toUTF8(data, charset), "\x00", "")
}

// decodeBase64Lenient 解码邮件里的 base64：忽略空白与折行，容忍缺失的填充符，
// 遇到 "=" 即视为结束。真实世界的邮件经常不严格遵守格式，严格解码会丢掉整段正文。
func decodeBase64Lenient(data []byte) []byte {
	clean := make([]byte, 0, len(data))
loop:
	for _, c := range data {
		switch {
		case c >= 'A' && c <= 'Z', c >= 'a' && c <= 'z', c >= '0' && c <= '9', c == '+', c == '/':
			clean = append(clean, c)
		case c == '=':
			break loop
		}
	}
	if len(clean)%4 == 1 { // 单独多出一个字符不构成完整字节，丢弃
		clean = clean[:len(clean)-1]
	}
	out := make([]byte, base64.RawStdEncoding.DecodedLen(len(clean)))
	n, _ := base64.RawStdEncoding.Decode(out, clean)
	return out[:n]
}

// toUTF8 按 label 指定的字符集把 data 转成 UTF-8。label 为空或不认识时，
// 按 UTF-8 处理并把非法字节替换为 U+FFFD，保证返回值一定是合法 UTF-8。
func toUTF8(data []byte, label string) string {
	if label = strings.TrimSpace(label); label != "" {
		if enc, err := lookupEncoding(label); err == nil {
			if out, err := enc.NewDecoder().Bytes(data); err == nil {
				return string(out)
			}
		}
	}
	return strings.ToValidUTF8(string(data), "\uFFFD")
}
