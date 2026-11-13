package store

import (
	"errors"
	"fmt"
	"strings"
)

const maxDomainLength = 253

// ValidateDomain 校验提交的域名，支持 "*.example.com" 通配写法。
//
// 此前提交的域名没有任何格式校验，畸形输入会直接进入 DNS 轮询队列和 Postfix 的 regexp 映射。
// 这里要求：至少两级、每个 label 符合 RFC 1035 主机名规则、顶级域不能全为数字（拒绝 IP 地址）。
// 国际化域名请使用 punycode（xn--）形式提交。
func ValidateDomain(input string) error {
	_, _, base := NormalizeDomain(input)
	if base == "" {
		return errors.New("域名不能为空")
	}
	if len(base) > maxDomainLength {
		return fmt.Errorf("域名过长（最多 %d 个字符）", maxDomainLength)
	}

	labels := strings.Split(base, ".")
	if len(labels) < 2 {
		return errors.New("域名必须至少包含两级，例如 example.com")
	}
	for _, label := range labels {
		if !domainLabelPattern.MatchString(label) {
			return fmt.Errorf("域名标签 %q 不合法：只能包含字母、数字和连字符，不能以连字符开头或结尾，长度 1-63；国际化域名请使用 punycode", label)
		}
	}
	if isAllDigits(labels[len(labels)-1]) {
		return errors.New("顶级域不能全为数字，不接受 IP 地址")
	}
	return nil
}

func isAllDigits(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return s != ""
}