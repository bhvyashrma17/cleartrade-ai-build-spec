// new_file.cpp
// Simple C++ example: Hello world and a small add() function.

#include <iostream>

// Adds two integers and returns the result
int add(int a, int b) {
    return a + b;
}

int main() {
    std::cout << "Hello from new_file.cpp!" << std::endl;

    int x = 3;
    int y = 4;
    std::cout << x << " + " << y << " = " << add(x, y) << std::endl;

    return 0;
}
