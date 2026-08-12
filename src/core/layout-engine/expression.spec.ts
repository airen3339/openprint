import { describe, expect, it } from 'vitest'

import {
  evaluate,
  evaluateVisible,
  interpolate,
  resolveBinding,
} from '@/core/layout-engine/expression'

// EvalContext 必须有 data 字段；测试里无变量时用 { data: {} }


describe('expression 安全表达式引擎', () => {
  it('基础算术与优先级', () => {
    expect(evaluate('1 + 2 * 3', { data: {} })).toBe(7)
    expect(evaluate('(1 + 2) * 3', { data: {} })).toBe(9)
    expect(evaluate('10 / 4', { data: {} })).toBe(2.5)
  })

  it('字符串拼接', () => {
    expect(evaluate('"a" + "b"', { data: {} })).toBe('ab')
    expect(evaluate('"x" + 1', { data: {} })).toBe('x1')
  })

  it('比较与逻辑', () => {
    expect(evaluate('3 > 2', { data: {} })).toBe(true)
    expect(evaluate('true && false', { data: {} })).toBe(false)
    expect(evaluate('true || false', { data: {} })).toBe(true)
    expect(evaluate('!false', { data: {} })).toBe(true)
  })

  it('变量从 ctx.data 取值', () => {
    expect(evaluate('x * 2', { data: { x: 5 } })).toBe(10)
    expect(evaluate('a + b', { data: { a: 2, b: 3 } })).toBe(5)
  })

  it('过滤器（经 interpolate 解析 {{ }} 管道）', () => {
    expect(interpolate('{{name | upper}}', { data: { name: 'abc' } }).text).toBe('ABC')
    expect(interpolate('{{name | lower}}', { data: { name: 'ABC' } }).text).toBe('abc')
    expect(interpolate('{{v | number:0}}', { data: { v: 1234.5 } }).text).toBe('1,235')
    expect(interpolate('{{amount | currency}}', { data: { amount: 12800.5 } }).text).toContain('12,800.50')
    expect(interpolate('{{v | default:"无"}}', { data: { v: '' } }).text).toBe('无')
    expect(interpolate('{{n | padStart:3}}', { data: { n: 7 } }).text).toBe('007')
  })

  it('resolveBinding 按路径取值', () => {
    expect(resolveBinding('a.b', { data: { a: { b: 1 } } })).toBe(1)
  })

  it('interpolate 替换 {{ }}', () => {
    expect(interpolate('{{x}}岁', { data: { x: 18 } }).text).toBe('18岁')
    expect(interpolate('单价{{price|currency}}', { data: { price: 9.9 } }).text).toContain('9.90')
    expect(interpolate('无占位', { data: {} }).text).toBe('无占位')
  })

  it('evaluateVisible 条件渲染', () => {
    expect(evaluateVisible('', { data: {} })).toBe(true)
    expect(evaluateVisible('  ', { data: {} })).toBe(true)
    expect(evaluateVisible('false', { data: {} })).toBe(false)
    expect(evaluateVisible('x > 3', { data: { x: 5 } })).toBe(true)
    expect(evaluateVisible('x > 3', { data: { x: 1 } })).toBe(false)
  })

  // —— 安全边界：绝不能执行任意 JS ——
  it('拒绝 eval / new Function / import 等代码注入', () => {
    expect(() => evaluate('eval("x")', { data: {} })).toThrow()
    expect(() => evaluate('new Function("return 1")', { data: {} })).toThrow()
    expect(() => evaluate('import("x")', { data: {} })).toThrow()
    expect(() => evaluate('window.location', { data: {} })).not.toThrow() // 读取未定义变量返回 undefined，而非执行
    expect(evaluate('window.location', { data: {} })).toBeUndefined()
  })

  it('语法错误抛出', () => {
    expect(() => evaluate('1 +', { data: {} })).toThrow()
    expect(() => evaluate('@#$', { data: {} })).toThrow()
  })
})
