#pragma once

#include <coroutine>
#include <optional>

template <typename T>
struct async_op;

template<typename T>
struct promise_t {
    std::optional<T> result;
    std::coroutine_handle<> continuation;
    std::exception_ptr exception;

    async_op<T> get_return_object() {
        return async_op<T>{std::coroutine_handle<promise_t<T>>::from_promise(*this)};
    }
    std::suspend_always initial_suspend() noexcept { return {}; }
    std::suspend_always final_suspend() noexcept { return {}; }
    void unhandled_exception() { exception = std::current_exception(); }
    void return_value(T value) {
        result = value;
        if (continuation) continuation.resume();
    }
};

template<>
struct promise_t<void> {
    std::coroutine_handle<> continuation;
    std::exception_ptr exception;

    async_op<void> get_return_object();
    std::suspend_always initial_suspend() noexcept { return {}; }
    std::suspend_always final_suspend() noexcept { return {}; }
    void unhandled_exception() { exception = std::current_exception(); }
    void return_void() {
        if (continuation) continuation.resume();
    }
};


template <typename T>
struct async_op {
    using promise_type = promise_t<T>;

    std::coroutine_handle<promise_type> handle;

    async_op(std::coroutine_handle<promise_type> h = nullptr) : handle(h) {}

    ~async_op() {
        if (handle) {
            handle.destroy();
        }
    }

    // Make move-only
    async_op(const async_op&) = delete;
    async_op& operator=(const async_op&) = delete;
    async_op(async_op&& other) noexcept : handle(other.handle) {
        other.handle = nullptr;
    }
    async_op& operator=(async_op&& other) noexcept {
        if (handle) {
            handle.destroy();
        }
        handle = other.handle;
        other.handle = nullptr;
        return *this;
    }

    bool await_ready() { return false; }

    void await_suspend(std::coroutine_handle<> h) {
        handle.promise().continuation = h;
        if (handle) handle.resume();
    }

    T await_resume() {
        if (handle.promise().exception) {
            std::rethrow_exception(handle.promise().exception);
        }
        if constexpr (!std::is_void_v<T>) {
            return *handle.promise().result;
        }
    }

    template <typename U = T>
    void resume(U value) requires (!std::is_void_v<U>) {
        handle.promise().result = value;
        if (handle.promise().continuation) {
            handle.promise().continuation.resume();
        }
    }

    // This overload is for void. It remains the same.
    void resume() requires (std::is_void_v<T>) {
        if (handle.promise().continuation) {
            handle.promise().continuation.resume();
        }
    }
};

inline async_op<void> promise_t<void>::get_return_object() {
    return async_op<void>{std::coroutine_handle<promise_t<void>>::from_promise(*this)};
}

template<typename Promise>
struct get_promise_t {
    Promise* promise;
    bool await_ready() noexcept { return false; }
    bool await_suspend(std::coroutine_handle<Promise> h) noexcept {
        promise = &h.promise();
        return false; // don't suspend
    }
    Promise& await_resume() noexcept { return *promise; }
};
